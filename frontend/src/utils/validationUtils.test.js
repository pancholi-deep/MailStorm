import { inspectCSVContent, validateTemplateContent } from './validationUtils';
import { parseTemplate } from './templateUtils';

const csv = (text) => inspectCSVContent(new File([text], 'contacts.csv'));

test('accepts quoted commas, escaped quotes, BOM, CRLF, and normalized headers', async () => {
  await expect(csv('\uFEFF Name , EMAIL\r\n"Doe, ""Jane""",jane@example.org\r\n')).resolves.toEqual(
    {
      columns: ['name', 'email'],
      sample: { name: 'Doe, "Jane"', email: 'jane@example.org' },
      recipient_count: 1,
    }
  );
});

test.each([
  'name,email',
  'name,email\nAlice,',
  'name,email\nAlice,broken@@gmail.com',
  'name,email\nAlice,a@gmail.com\nBob,broken',
  'name,email,email\nAlice,a@gmail.com,a@gmail.com',
  'name,email\nAlice,a@gmail.com,b@gmail.com',
  'name,email\n"unterminated,a@gmail.com',
])('rejects invalid CSV before sending: %s', async (text) => {
  await expect(csv(text)).rejects.toThrow(/CSV/);
});

test('template parser preserves inline body text and resets HTML format', () => {
  const html = parseTemplate('<!-- Subject: Hello -->\n<html><p>Hi {name}</p></html>', 'mail.HTML');
  expect(html).toEqual({ subject: 'Hello', body: '<html><p>Hi {name}</p></html>', isHtml: true });
  const plain = parseTemplate('Subject: Hello\r\nBody: Inline text\r\nNext line', 'mail.txt');
  expect(plain).toEqual({ subject: 'Hello', body: 'Inline text\nNext line', isHtml: false });
});

test('HTML fragments preserve markup and need not include a full HTML document', async () => {
  await expect(
    validateTemplateContent(new File(['<p>Hi {name}</p>'], 'mail.html'))
  ).resolves.toEqual({ subject: '', body: '<p>Hi {name}</p>', isHtml: true });
});

test('missing and empty text bodies are rejected', () => {
  expect(() => parseTemplate('Subject: Hi')).toThrow(/Body/);
  expect(() => parseTemplate('Subject: Hi\nBody:')).toThrow(/empty/);
});
