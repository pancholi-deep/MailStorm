const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
export const isFieldName = (value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

export function templateFields(subject, body) {
  const fields = new Set();
  for (const match of `${subject}\n${body}`.matchAll(PLACEHOLDER)) fields.add(match[1]);
  return [...fields];
}

export function activeMapping(subject, body, mapping = {}) {
  return Object.fromEntries(
    templateFields(subject, body)
      .sort()
      .filter((key) => Object.hasOwn(mapping, key) && mapping[key] !== key)
      .map((key) => [key, mapping[key]])
  );
}

export function missingFields(subject, body, mapping, columns) {
  return templateFields(subject, body).filter(
    (key) => !columns.includes(Object.hasOwn(mapping, key) ? mapping[key] : key)
  );
}

export function validateFieldMapping(subject, body, mapping, columns) {
  const missing = missingFields(subject, body, mapping, columns);
  if (missing.length)
    throw new Error(`Map these placeholders to CSV columns: ${missing.join(', ')}`);
}

const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[char]
  );

export function previewMessage(text, sample, mapping, isHtml = false, limit = 2000) {
  let result = '';
  let cursor = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    result += text.slice(cursor, match.index).slice(0, limit - result.length);
    if (result.length >= limit) return result;
    const [token, key] = match;
    const column = Object.hasOwn(mapping, key) ? mapping[key] : key;
    let value = Object.hasOwn(sample, column) ? sample[column] : token;
    if (key === 'name') value = value.split(/\s+/)[0];
    value = value.slice(0, limit - result.length);
    result += (isHtml ? escapeHtml(value) : value).slice(0, limit - result.length);
    if (result.length >= limit) return result;
    cursor = match.index + token.length;
  }
  return result + text.slice(cursor, cursor + limit - result.length);
}
