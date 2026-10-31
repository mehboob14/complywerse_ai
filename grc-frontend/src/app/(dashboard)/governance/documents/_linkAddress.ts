// The address a link is made of, as the link dialog treats it (the rich-text editors of the AI Studio and of the library). Pure, so `node --test`
// pins it (_linkAddress.test.ts). The dialog replaced window.prompt('Link address', previous || 'https://'): the same start, the same result.

/** What the field starts with when the cursor is not on a link: what the browser prompt offered. */
export const LINK_START = 'https://';

/** The field's first value: the link under the cursor, else the start. */
export function startingAddress(previous?: string | null): string {
  return previous && previous.trim() ? previous : LINK_START;
}

/** The address to link to, or null when there is nothing to link to: blank, or only the start that was offered. The browser prompt turned a blank
 *  answer into "take the link off"; the dialog has its own button for that, so a blank field is asked again instead. */
export function addressToLink(typed: string): string | null {
  const address = typed.trim();
  return address === '' || address === LINK_START ? null : address;
}
