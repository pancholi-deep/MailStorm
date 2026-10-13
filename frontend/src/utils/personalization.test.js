import { activeMapping, missingFields, previewMessage } from './personalization';
import { inspectCSVContent } from './validationUtils';

test('inspects all CSV headers and preserves complete sample values', async () => {
  const text = '\uFEFFName,EMAIL, Company Name ,notes\nAlice Smith,a@example.org,"Acme, Inc.",';
  const result = await inspectCSVContent(new File([text], 'contacts.csv'));
  expect(result.columns).toEqual(['name', 'email', 'company name', 'notes']);
  expect(result.sample).toEqual({
    name: 'Alice Smith',
    email: 'a@example.org',
    'company name': 'Acme, Inc.',
    notes: '',
  });
});

test('only used aliases participate in saving and send identity', () => {
  expect(
    activeMapping('{company}', '{name} {company}', {
      company: 'company name',
      name: 'name',
      unused: 'old',
    })
  ).toEqual({ company: 'company name' });
  expect(
    missingFields('{company}', '{missing}', { company: 'company name' }, ['company name'])
  ).toEqual(['missing']);
});

test('preview escapes HTML, preserves blank cells and does not recursively substitute CSV values', () => {
  const sample = {
    name: 'Alice Smith',
    email: 'a@example.org',
    company: '<Acme & "Co"> {email}',
    empty: '',
  };
  expect(
    previewMessage('{name}/{full_name}/{blank}/{missing}', sample, {
      full_name: 'name',
      blank: 'empty',
    })
  ).toBe('Alice/Alice Smith//{missing}');
  expect(previewMessage('<p>{company}</p>', sample, {}, true)).toBe(
    '<p>&lt;Acme &amp; &quot;Co&quot;&gt; {email}</p>'
  );
});

test('prototype-shaped column names are treated as data', () => {
  const sample = JSON.parse('{"__proto__":"Acme","constructor":"Sales"}');
  expect(previewMessage('{__proto__} {constructor}', sample, {})).toBe('Acme Sales');
  expect(missingFields('{constructor}', '', {}, ['name', 'email'])).toEqual(['constructor']);
});

test('preview bounds repeated large values before constructing the rendered message', () => {
  const output = previewMessage(
    '{company}'.repeat(10000),
    { company: '&'.repeat(100000) },
    {},
    true
  );
  expect(output).toHaveLength(2000);
  expect(output.startsWith('&amp;')).toBe(true);
});
