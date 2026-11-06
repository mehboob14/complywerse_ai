// node --test "src/app/attest/[token]/attestLogic.test.ts"
// The public attestation page: how a document is read (its kind), where its file and pages are asked for, what a text may carry, and
// that the page keeps the rules of a page nobody signs in to (no raw HTML but the server's cleaned kind, no remote picture, no script link).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { dueDay, markdownUrl, pageNumbers, pageUrl, pagesNote, readKind, titleLine, withTenant, type PublicDocument } from './_logic.ts';
import { hardenLinks, isSafeLink } from '../../../components/governance/safeLinks.ts';

const doc = (over: Partial<PublicDocument>): PublicDocument => ({ title: 'Access Control Policy', ...over });
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('a document is read the way the server says, and nothing that is empty is drawn', () => {
  assert.equal(readKind(doc({ kind: 'markdown', markdown: '# A' })), 'markdown');
  assert.equal(readKind(doc({ kind: 'markdown', markdown: '  ' })), 'none');
  assert.equal(readKind(doc({ kind: 'html', html: '<p>x</p>' })), 'html');
  assert.equal(readKind(doc({ kind: 'text', content: 'x' })), 'text');
  assert.equal(readKind(doc({ kind: 'word', file: { kind: 'docx', url: '/f' } })), 'word');
  assert.equal(readKind(doc({ kind: 'word' })), 'none');
  assert.equal(readKind(doc({ kind: 'pdf', file: { kind: 'pdf', url: '/f' }, pages: { count: 3, total: 3, ratio: 1.41, url: '/p/{page}' } })), 'pdf');
  assert.equal(readKind(doc({ kind: 'pdf', file: { kind: 'pdf', url: '/f' }, pages: { count: 0, total: 0, ratio: 1.41, url: '/p/{page}' } })), 'none');
  assert.equal(readKind(doc({ kind: 'none' })), 'none');
});

test('an older server (no kind) is still read: its html, else its text', () => {
  assert.equal(readKind(doc({ html: '<p>x</p>', content: null })), 'html');
  assert.equal(readKind(doc({ content: 'plain' })), 'text');
  assert.equal(readKind(doc({})), 'none');
});

test('the file and the pages are asked for with the tenant in the address, because an image cannot send a header', () => {
  assert.equal(withTenant('/governance/x/file?v=1.0', 'cfsb'), '/governance/x/file?v=1.0&tenant_slug=cfsb');
  assert.equal(withTenant('/governance/x/file', 'cfsb'), '/governance/x/file?tenant_slug=cfsb');
  assert.equal(withTenant('/governance/x/file', null), '/governance/x/file');
  assert.equal(withTenant('/a', 'a b&c'), '/a?tenant_slug=a%20b%26c');
  assert.equal(pageUrl('/governance/x/pages/{page}?v=2.1', 7, '/api', 'cfsb'), '/api/governance/x/pages/7?v=2.1&tenant_slug=cfsb');
  assert.deepEqual(pageNumbers(3), [1, 2, 3]);
  assert.deepEqual(pageNumbers(0), []);
  assert.deepEqual(pageNumbers(-2), []);
});

test('a text may carry a picture only when the picture is inside it, and link only to the web, e-mail or phone', () => {
  assert.equal(markdownUrl(PNG, 'src'), PNG);
  assert.equal(markdownUrl('https://evil.example/pixel.png', 'src'), '');
  assert.equal(markdownUrl('data:image/svg+xml;base64,PHN2Zz4=', 'src'), '');
  assert.equal(markdownUrl('data:text/html;base64,PHNjcmlwdD4=', 'src'), '');
  assert.equal(markdownUrl('https://example.com/p?a=1', 'href'), 'https://example.com/p?a=1');
  assert.equal(markdownUrl('mailto:a@b.co', 'href'), 'mailto:a@b.co');
  for (const bad of ['javascript:alert(1)', ' java\tscript:alert(1)', 'JaVaScRiPt:1', 'vbscript:1', 'data:text/html,x', '/governance/documents/5', '//evil.example', '#x']) {
    assert.equal(markdownUrl(bad, 'href'), '', bad);
  }
});

test('the renderer, with that filter, draws structure and never loads or runs anything', () => {
  const md = [
    '# Access Control Policy', '', '## 1. Purpose', '', '1. Grant access on need.', '2. Review it **quarterly**.', '',
    '| Role | Owner |', '| --- | --- |', '| CISO | Ana |', '',
    `Kept ![logo](${PNG}) and ![pixel](https://evil.example/p.png) and [bad](javascript:alert(1)) and [good](https://example.com/p).`, '',
    '<img src="https://evil.example/raw.png" onerror="alert(1)"><script>alert(2)</script>',
  ].join('\n');
  const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], urlTransform: markdownUrl }, md));
  assert.match(html, /<h1>Access Control Policy<\/h1>/);
  assert.match(html, /<h2>1\. Purpose<\/h2>/);
  assert.match(html, /<ol>[\s\S]*<strong>quarterly<\/strong>/);
  assert.match(html, /<table>[\s\S]*<th>Role<\/th>[\s\S]*<td>Ana<\/td>/);
  assert.match(html, new RegExp(`<img src="${PNG}"`));
  assert.ok(!/<script/.test(html) && !/onerror="/.test(html), html);              // raw HTML is shown as text, not parsed
  assert.ok(!/<img[^>]*evil\.example/.test(html), html);
  assert.ok(!/href="javascript/i.test(html), html);
  assert.match(html, /href="https:\/\/example\.com\/p"/);
});

test('a link in a Word file is made inert unless it goes to the web, an e-mail, a phone or a place in the document', () => {
  for (const ok of ['https://example.com', 'HTTP://example.com', 'mailto:a@b.co', 'tel:+971500000000', '#_Toc123']) assert.ok(isSafeLink(ok), ok);
  for (const bad of ['javascript:alert(1)', ' java\tscript:alert(1)', 'data:text/html,x', 'file:///c:/x', 'vbscript:x', '/governance/documents/5', '', null, undefined]) {
    assert.ok(!isSafeLink(bad as string), String(bad));
  }
  const hidden = `jav${String.fromCharCode(0x200b)}ascript:alert(1)`;              // a zero-width space inside the scheme
  assert.ok(!isSafeLink(hidden) && markdownUrl(hidden, 'href') === '');
  const attrs = (init: Record<string, string>) => {
    const map = { ...init };
    return {
      getAttribute: (k: string) => map[k] ?? null, setAttribute: (k: string, v: string) => { map[k] = v; },
      removeAttribute: (k: string) => { delete map[k]; }, map,
    };
  };
  const links = [attrs({ href: 'javascript:alert(1)' }), attrs({ href: 'https://example.com' }), attrs({ href: '#_Toc1' })];
  hardenLinks({ querySelectorAll: () => links } as unknown as ParentNode);
  assert.equal(links[0].map.href, undefined);
  assert.deepEqual(links[1].map, { href: 'https://example.com', target: '_blank', rel: 'noopener noreferrer' });
  assert.deepEqual(links[2].map, { href: '#_Toc1' });
});

test('the title block says the type, the version and the due day in few words', () => {
  assert.equal(titleLine({ doc_type: 'policy', version: '1.0' }), 'Policy · Version 1.0');
  assert.equal(titleLine({ doc_type: 'risk_assessment', version: '2.1' }), 'Risk assessment · Version 2.1');
  assert.equal(titleLine({ doc_type: null, version: null }), '');
  assert.equal(dueDay('2026-11-12T00:00:00'), '12 Nov 2026');
  assert.equal(dueDay('2026-01-05'), '5 Jan 2026');
  assert.equal(dueDay(null), null);
  assert.equal(dueDay('soon'), null);
  assert.equal(pagesNote({ count: 150, total: 230, ratio: 1.4, url: '' }), 'Showing the first 150 of 230 pages.');
  assert.equal(pagesNote({ count: 3, total: 3, ratio: 1.4, url: '' }), null);
});

test('the page draws HTML only from the server\'s cleaned kind, and says nothing a person should not read', () => {
  const dir = new URL('./', import.meta.url);
  const source = (f: string) => readFileSync(new URL(f, dir), 'utf8');
  const page = source('page.tsx');
  const reader = source('_Reader.tsx');
  assert.ok(!/dangerouslySetInnerHTML/.test(page), 'the page itself draws no HTML');
  assert.equal((reader.match(/dangerouslySetInnerHTML/g) || []).length, 1, 'one place draws HTML: the "html" kind');
  assert.match(reader, /case 'html':[\s\S]{0,200}dangerouslySetInnerHTML/);
  assert.ok(!/max-h-\[\d+vh\]|overflow-y-auto/.test(reader + page), 'the document is read at full height, not in a small scroll box');
  assert.match(source('../layout.tsx'), /referrer: 'no-referrer'/);
});

test('a text drawn by the document renderer is read in ink: the shell repaints its text-gray-* classes in muted grey unless the page says otherwise', () => {
  const dir = new URL('./', import.meta.url);
  const reader = readFileSync(new URL('_Reader.tsx', dir), 'utf8');
  const css = readFileSync(new URL('_reading.module.css', dir), 'utf8');
  assert.match(reader, /MARKDOWN_READING = `\$\{styles\.ink\}/);
  assert.match(css, /\.ink :is\([^)]*\bp\b[^)]*\)\s*\{\s*color: #1f2933 !important/);
  assert.match(css, /\.ink a \{ color: #0b5cad !important/);
});
