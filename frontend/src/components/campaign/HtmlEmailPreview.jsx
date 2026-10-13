import React, { useMemo } from 'react';

const TAGS = new Set(
  'p br div span table thead tbody tfoot tr td th h1 h2 h3 h4 h5 h6 ul ol li a strong b em i u s small blockquote hr center'.split(
    ' '
  )
);
const OMIT = new Set(
  'script style iframe object embed form input button textarea select svg math img video audio link meta base'.split(
    ' '
  )
);
const ATTRIBUTES = new Set(
  'style width height align valign cellpadding cellspacing colspan rowspan border role dir lang'.split(
    ' '
  )
);

// Rebuild an inert, presentation-only document. The original email is never changed.
export function previewDocument(html) {
  // Template contents remain inert even for resource elements while being parsed.
  const source = window.document.createElement('template');
  source.innerHTML = html;
  const document = new DOMParser().parseFromString(
    '<!doctype html><html><head></head><body></body></html>',
    'text/html'
  );
  const copy = (node, parent, depth = 0) => {
    if (depth > 100) return;
    if (node.nodeType === 3) {
      parent.appendChild(document.createTextNode(node.textContent));
      return;
    }
    if (node.nodeType !== 1 || OMIT.has(node.localName)) return;
    let target = parent;
    if (TAGS.has(node.localName)) {
      target = document.createElement(node.localName);
      for (const attribute of node.attributes) {
        if (
          ATTRIBUTES.has(attribute.name) &&
          !/url\s*\(|expression\s*\(|@import|\\/i.test(attribute.value)
        ) {
          target.setAttribute(attribute.name, attribute.value);
        }
      }
      parent.appendChild(target);
    }
    for (const child of node.childNodes) copy(child, target, depth + 1);
  };
  for (const child of source.content.childNodes) copy(child, document.body);
  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content =
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; base-uri 'none'";
  document.head.appendChild(policy);
  const style = document.createElement('style');
  style.textContent =
    'body{margin:0;background:#fff;color:#24334a;font:16px/1.6 Arial,sans-serif;overflow-wrap:anywhere}table{max-width:100%}a{cursor:default}';
  document.head.appendChild(style);
  return '<!doctype html>' + document.documentElement.outerHTML;
}

export default function HtmlEmailPreview({ body }) {
  const document = useMemo(() => previewDocument(body), [body]);
  return (
    <div className="html-email-preview">
      <iframe title="Email preview" sandbox="" referrerPolicy="no-referrer" srcDoc={document} />
      <p className="muted">
        Layout preview. Links and external images are disabled here. Email apps may render styling
        differently.
      </p>
    </div>
  );
}
