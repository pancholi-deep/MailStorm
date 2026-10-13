import Papa from 'papaparse';
import { parseTemplate } from './templateUtils';

const EMAIL_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const MAX_CSV_BYTES = Number(process.env.REACT_APP_MAX_CSV_BYTES || 2097152);
const MAX_RECIPIENTS = Number(process.env.REACT_APP_MAX_RECIPIENTS || 500);

export async function inspectCSVContent(file) {
  if (file.size > MAX_CSV_BYTES)
    throw new Error(`CSV exceeds the ${MAX_CSV_BYTES}-byte upload limit`);
  let headers;
  let count = 0;
  let sample;
  const consume = (data, errors = []) => {
    if (errors.length) throw new Error('CSV contains malformed quoted fields');
    if (!headers) {
      headers = data.map((value) =>
        value
          .replace(/^\uFEFF/, '')
          .trim()
          .toLowerCase()
      );
      if (
        headers.length > 32 ||
        headers.some((header) => !header || header.length > 128 || /[\r\n\0]/.test(header)) ||
        new Set(headers).size !== headers.length ||
        !headers.includes('name') ||
        !headers.includes('email')
      ) {
        throw new Error("CSV must contain unique 'name' and 'email' columns");
      }
      return;
    }
    const values = data.map((value) => value.trim());
    if (values.every((value) => !value)) return;
    if (values.length !== headers.length)
      throw new Error('CSV row has an incorrect number of columns');
    const name = values[headers.indexOf('name')];
    const email = values[headers.indexOf('email')];
    if (!name || !email) throw new Error('CSV row requires name and email');
    if (name.length > 200 || /[\r\n]/.test(name) || name.includes('\0'))
      throw new Error('CSV row has an invalid name');
    const local = email.split('@')[0];
    if (
      email.length > 254 ||
      local.length > 64 ||
      !EMAIL_PATTERN.test(email) ||
      local.includes('..') ||
      local.startsWith('.') ||
      local.endsWith('.')
    ) {
      throw new Error('CSV row has an invalid email address');
    }
    if (++count > MAX_RECIPIENTS)
      throw new Error(`CSV must contain at most ${MAX_RECIPIENTS} recipients`);
    if (!sample)
      sample = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  };
  await new Promise((resolve, reject) => {
    Papa.parse(file, {
      delimiter: ',',
      chunkSize: 262144,
      step: (result, parser) => {
        try {
          consume(result.data, result.errors);
        } catch (error) {
          reject(error);
          parser.abort();
        }
      },
      complete: resolve,
      error: reject,
    });
  });
  if (!count) throw new Error('CSV must contain at least one recipient');
  return { columns: headers, sample, recipient_count: count };
}

export async function validateTemplateContent(file) {
  if (file.size > 2097152) throw new Error('Template exceeds the 2 MB upload limit');
  const text = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
  return parseTemplate(text, file.name);
}
