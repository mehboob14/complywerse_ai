// The folder icons of the library's Folders layout, the Properties popup and the path bar, drawn here and nowhere else: a flat Windows-style folder (a back panel with its tab, a
// lighter front panel), an open one (the front panel leans back), and a grey one for a unit that is switched off. SVG, so they stay sharp at 16px in a row and 48px in an empty state.
// The documents keep the library's own file icons.
//
// THE ONE FILE WITH COLOUR CODES: the folder's two yellows and its grey are hex here, as named constants on `fill` attributes, because they are the platform's picture of a folder, not
// theme colours: they do not change in dark mode, as Windows' yellow folder does not. Nothing else in the Folders layout writes a colour code; every other colour is a --ds token
// (kitRules.ts: no hex in a class name). Every icon is decoration (aria-hidden): the name and the state are always said in words next to it or in its tooltip, never by colour alone.

/** The folder: the back panel (with its tab), the front panel, and the grey pair of a unit that is switched off. */
export const FOLDER_BACK = '#E9A91C';
export const FOLDER_FRONT = '#FFD35C';
export const FOLDER_GREY_BACK = '#98A1AD';
export const FOLDER_GREY_FRONT = '#C7CDD5';
/** The mark on a folder: a unit's "has its own defaults" badge (white tick on the primary token's disc) needs one white. */
const WHITE = '#FFFFFF';

interface FolderProps {
  /** pixels: 48 in an empty state, 16 to 24 in a row, the path bar and the popup */
  size: number;
  /** the folder is open (a row that shows what is inside it) or the one you are in: its front panel leans back */
  open?: boolean;
  /** the unit is switched off: grey, with a small mark (from 32px up; below that the grey and the word next to it say it) */
  inactive?: boolean;
  /** the unit defines its own approval defaults: a small badge (from 32px up) */
  badge?: boolean;
  /** the tooltip: what the marks mean, in words */
  title?: string;
  className?: string;
}

export function FolderIcon({ size, open = false, inactive = false, badge = false, title, className }: FolderProps) {
  const back = inactive ? FOLDER_GREY_BACK : FOLDER_BACK;
  const front = inactive ? FOLDER_GREY_FRONT : FOLDER_FRONT;
  const marks = size >= 32;
  return (
    <svg aria-hidden focusable="false" viewBox="0 0 48 48" width={size} height={size} className={className ?? 'shrink-0'}>
      {title && <title>{title}</title>}
      <path d="M4 9.5A2.5 2.5 0 0 1 6.5 7h11.4a2.5 2.5 0 0 1 1.8.75l3.1 3.25H41.5A2.5 2.5 0 0 1 44 13.5v24a2.5 2.5 0 0 1-2.5 2.5h-35A2.5 2.5 0 0 1 4 37.5Z" fill={back} />
      {open
        ? <path d="M2.4 38.6 7.1 21.1A2.5 2.5 0 0 1 9.5 19.3H45a2 2 0 0 1 1.9 2.6L42.4 38.4A2.5 2.5 0 0 1 40 40.2H4.9a2.5 2.5 0 0 1-2.5-1.6Z" fill={front} />
        : <rect x="4" y="16" width="40" height="24" rx="2.5" fill={front} />}
      {marks && inactive && (
        <g>
          <circle cx="38" cy="36" r="8.5" fill={WHITE} stroke={FOLDER_GREY_BACK} strokeWidth="2" />
          <path d="M33.5 36h9" stroke={FOLDER_GREY_BACK} strokeWidth="2.4" strokeLinecap="round" />
        </g>
      )}
      {marks && badge && (
        <g>
          <circle cx="39" cy="12" r="7.5" className="fill-ds-primary" stroke={WHITE} strokeWidth="2" />
          <path d="m35.6 12.2 2.3 2.3 4-4.4" fill="none" stroke={WHITE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}
