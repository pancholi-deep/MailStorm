import React from 'react';
import { render, screen } from '@testing-library/react';
import HtmlEmailPreview, { previewDocument } from './HtmlEmailPreview';

test('preview preserves email layout and placeholders without live resources or navigation', () => {
  const body =
    '<html><head><base href="https://bad.example"><meta http-equiv="refresh" content="0;url=https://bad.example"></head><body onload="bad()"><table cellpadding="0" style="max-width:600px"><tr><td><h1>Hello {name}</h1><a href="https://example.org" target="_top" onclick="bad()" style="color:blue">Learn more</a><img src="https://bad.example/track"><iframe src="https://bad.example"></iframe><script>bad()</script><div style="background:url(https://bad.example)">Text</div></td></tr></table></body></html>';
  render(<HtmlEmailPreview body={body} />);
  const frame = screen.getByTitle('Email preview');
  expect(frame).toHaveAttribute('sandbox', '');
  expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  const html = new DOMParser().parseFromString(frame.getAttribute('srcdoc'), 'text/html');
  expect(html.querySelector('h1').textContent).toBe('Hello {name}');
  expect(html.querySelector('table').getAttribute('cellpadding')).toBe('0');
  expect(html.querySelector('a').getAttribute('style')).toBe('color:blue');
  expect(
    html.querySelector('script, iframe, img, base, [href], [src], [onload], [onclick], [target]')
  ).toBeNull();
  expect(html.querySelector('div').hasAttribute('style')).toBe(false);
  expect(html.head.querySelector('meta').getAttribute('content')).toContain("default-src 'none'");
});

test('malformed and deeply nested HTML can be previewed without executing it', () => {
  expect(() => previewDocument('<div>'.repeat(250) + '<img src=x onerror=bad()>Hi')).not.toThrow();
  expect(previewDocument('<p>Hello &lt;script&gt; {name}')).toContain(
    'Hello &lt;script&gt; {name}'
  );
});
