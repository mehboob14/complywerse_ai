// A Word file is the author's, and a link in it is whatever the author typed: docx-preview copies the address as it is, a `javascript:` one
// included. Nothing in a document needs that, so after a Word file is drawn every link that is not the web, an e-mail, a phone number or a
// place inside the document is made inert, and the ones that remain open in a new tab without telling the target who sent the reader.

// a browser ignores these inside a scheme ("java\tscript:"), so they are taken out before the scheme is looked at
const INVISIBLE = new RegExp(String.raw`[\p{C}\p{Z}]+`, 'gu');       // (a literal with the u flag needs a newer compile target)
const WEB = /^(?:https?:|mailto:|tel:)/i;

/** A place in the document (`#_Toc123`), the web, an e-mail or a phone number. */
export function isSafeLink(href: string | null | undefined): boolean {
  const clean = (href || '').replace(INVISIBLE, '');
  return clean.startsWith('#') || WEB.test(clean);
}

/** Take the address off every link under `root` that is not safe; open the others in a new tab (a place in the document stays where it is). */
export function hardenLinks(root: ParentNode): void {
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href');
    if (!isSafeLink(href)) {
      a.removeAttribute('href');
    } else if (!(href || '').trim().startsWith('#')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }
}

/** A picture in a Word file has no description the page can read out: say what it is, so a screen reader does not read its file name. */
export function labelPictures(root: ParentNode): void {
  for (const img of Array.from(root.querySelectorAll('img:not([alt])'))) img.setAttribute('alt', 'Picture in the document');
}
