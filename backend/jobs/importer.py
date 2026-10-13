import csv
import hashlib
import io
from backend.core.config import settings
from backend.utils.validation import valid_email, validate_rendered_templates


class LimitedReader(io.RawIOBase):
    def __init__(self, source, expected):
        self.source = source
        self.expected = expected
        self.size = 0
        self.digest = hashlib.sha256()

    def readable(self):
        return True

    def readinto(self, buffer):
        data = self.source.read(min(len(buffer), 65536))
        self.size += len(data)
        if self.size > min(self.expected, settings.max_csv_bytes):
            raise ValueError('CSV exceeds the upload limit')
        self.digest.update(data)
        buffer[:len(data)] = data
        return len(data)


def import_campaign(store, objects, job):
    upload = store.upload(job['owner'], job['upload_id'])
    store.begin_import(job)
    template = job['template']
    with objects.open(job['upload_id']) as source:
        limited = LimitedReader(source, upload['size'])
        with io.TextIOWrapper(io.BufferedReader(limited), encoding='utf-8-sig', newline='') as text:
            reader = csv.reader(text, strict=True)
            try:
                headers = [value.strip().lower() for value in next(reader)]
                if len(headers) > 32 or len(set(headers)) != len(headers) or not {'name', 'email'}.issubset(headers):
                    raise ValueError("CSV must contain unique 'name' and 'email' columns (at most 32 columns)")
                count = 0
                chunk = []
                for values in reader:
                    if not values or all(not value.strip() for value in values):
                        continue
                    if len(values) != len(headers):
                        raise ValueError(f'CSV row {reader.line_num} has an incorrect number of columns')
                    row = dict(zip(headers, (value.strip() for value in values)))
                    if not row['name'] or not row['email']:
                        raise ValueError(f'CSV row {reader.line_num} requires name and email')
                    if len(row['name']) > 200 or any(value in row['name'] for value in '\r\n\x00') or not valid_email(row['email']):
                        raise ValueError(f'CSV row {reader.line_num} has an invalid name or email address')
                    count += 1
                    if count > settings.max_recipients:
                        raise ValueError(f'CSV must contain at most {settings.max_recipients} recipients')
                    recipient = {'name': row['name'].split()[0], 'email': row['email']}
                    chunk.append((count, recipient))
                    if len(chunk) == 250:
                        validate_rendered_templates(template['subject'], template['body'], [r for _, r in chunk], template['is_html'])
                        if not store.import_chunk(job, chunk):
                            store.release(job, 'cancelled')
                            return
                        chunk = []
                if not count:
                    raise ValueError('CSV must contain at least one recipient')
                if limited.size != upload['size'] or limited.digest.hexdigest() != upload['sha256']:
                    raise ValueError('Upload checksum does not match its reservation')
                if chunk:
                    validate_rendered_templates(template['subject'], template['body'], [r for _, r in chunk], template['is_html'])
                    if not store.import_chunk(job, chunk):
                        store.release(job, 'cancelled')
                        return
            except (UnicodeError, csv.Error, StopIteration) as exc:
                raise ValueError('CSV must be a nonempty, valid UTF-8 CSV file') from exc
    store.finish_import(job)
    store.release(job, 'queued')
