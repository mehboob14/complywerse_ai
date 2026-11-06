// What the public attestation page decides without drawing anything: how a document is read (its kind), the addresses of its file and
// pages (always with the tenant, as an <img> or a fetch cannot send a header), the one kind of picture a text may carry, and the
// words of the title block. Pure, so attestLogic.test.ts runs it under node.

export type ReadKind = 'markdown' | 'html' | 'text' | 'word' | 'pdf' | 'none';

export interface PublicDocument {
  title: string;
  description?: string | null;
  version?: string | null;
  doc_type?: string | null;
  has_file?: boolean;
  file_name?: string | null;
  /** how to read it; absent from an older server, which sent `html` or `content` */
  kind?: ReadKind;
  markdown?: string | null;
  html?: string | null;
  content?: string | null;
  file?: { kind: 'pdf' | 'docx'; url: string } | null;
  /** a Word file's text as Markdown that reflows: for a narrow screen, and when the drawing fails */
  text_url?: string | null;
  pages?: { count: number; total: number; ratio: number; url: string } | null;
}

/** The way to read a document: the server's `kind`, else what an older server sent. A kind with nothing to show is "none". */
export function readKind(doc: PublicDocument): ReadKind {
  const k = doc.kind;
  if (k === 'markdown') return doc.markdown?.trim() ? 'markdown' : 'none';
  if (k === 'html') return doc.html?.trim() ? 'html' : 'none';
  if (k === 'text') return doc.content?.trim() ? 'text' : 'none';
  if (k === 'word') return doc.file ? 'word' : 'none';
  if (k === 'pdf') return doc.file && doc.pages && doc.pages.count > 0 ? 'pdf' : 'none';
  if (k === 'none') return 'none';
  if (doc.html?.trim()) return 'html';
  return doc.content?.trim() ? 'text' : 'none';
}

/** An address on the API with the tenant in it (`?tenant_slug=`), added to an address that may already have a query (`?v=1.0`). */
export function withTenant(url: string, tenantSlug: string | null | undefined): string {
  if (!tenantSlug) return url;
  return `${url}${url.includes('?') ? '&' : '?'}tenant_slug=${encodeURIComponent(tenantSlug)}`;
}

/** Page `n` of the PDF: the server's template (`.../pages/{page}?v=1.0`) filled in, on the API's base address, with the tenant. */
export function pageUrl(template: string, n: number, base: string, tenantSlug: string | null | undefined): string {
  return withTenant(`${base}${template.replace('{page}', String(n))}`, tenantSlug);
}

/** The pages to draw: 1..count. */
export function pageNumbers(count: number): number[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => i + 1);
}

const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i;
const LINK = /^(?:https?:|mailto:|tel:)/i;
// a browser ignores these inside a scheme ("java\tscript:"), so they are taken out before the scheme is looked at
const INVISIBLE = new RegExp(String.raw`[\p{C}\p{Z}]+`, 'gu');       // (a literal with the u flag needs a newer compile target)

/** react-markdown's address filter for a text read by someone who is not signed in: a picture is only one that is inside the text (a
 *  remote one would tell its owner who read the document), a link only goes to the web, an e-mail or a phone. Anything else is empty. */
export function markdownUrl(url: string, key: string): string {
  const clean = url.replace(INVISIBLE, '');
  if (key === 'src') return DATA_IMAGE.test(clean) ? clean : '';
  return LINK.test(clean) ? clean : '';
}

/** "Policy · Version 1.0" under the title. */
export function titleLine(doc: Pick<PublicDocument, 'doc_type' | 'version'>): string {
  const type = (doc.doc_type || '').replace(/[_-]+/g, ' ').trim();
  return [type ? type.charAt(0).toUpperCase() + type.slice(1) : '', doc.version ? `Version ${doc.version}` : ''].filter(Boolean).join(' · ');
}

/** "Showing the first 150 of 230 pages." when the PDF is longer than what is drawn, else nothing. */
export function pagesNote(pages: PublicDocument['pages']): string | null {
  return pages && pages.total > pages.count ? `Showing the first ${pages.count} of ${pages.total} pages.` : null;
}

/** A calendar day as "12 Nov 2026" (the server sends the due date as a date-time without a zone; only its day matters). */
export function dueDay(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}
