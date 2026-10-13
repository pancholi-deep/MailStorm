export function parseTemplate(text, filename = '') {
  const content = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!content) throw new Error('Template is empty');
  const isHtml = /\.html$/i.test(filename) || /<!doctype\s+html|<html(?:\s|>)/i.test(content);
  const comment = content.match(/<!--\s*Subject:\s*([\s\S]*?)\s*-->/i);
  if (isHtml) {
    return {
      subject: comment ? comment[1].trim() : '',
      body: comment ? content.replace(comment[0], '').trim() : content,
      isHtml: true,
    };
  }
  const lines = content.split('\n');
  const subjectIndex = lines.findIndex(line => /^\s*subject:/i.test(line));
  const bodyIndex = lines.findIndex(line => /^\s*body:/i.test(line));
  if (subjectIndex < 0) throw new Error("Template must contain a 'Subject:' line");
  if (bodyIndex < 0 || bodyIndex <= subjectIndex) throw new Error("Template must contain a 'Body:' line after the subject");
  const subject = lines[subjectIndex].replace(/^\s*subject:/i, '').trim();
  const body = [lines[bodyIndex].replace(/^\s*body:/i, ''), ...lines.slice(bodyIndex + 1)].join('\n').trim();
  if (!body) throw new Error('Template body is empty');
  return { subject, body, isHtml: false };
}
