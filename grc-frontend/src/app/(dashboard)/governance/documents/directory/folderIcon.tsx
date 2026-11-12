// The Directory's icons, drawn here and nowhere else: a flat Windows-style folder (a back panel with its tab, a lighter front panel), an open one (the front panel leans back), a grey
// one for a unit that is switched off, and a document page (a folded corner, a coloured band for its type, a dot for its status). They are SVG, so they stay sharp at 16px in the tree
// and 48px in Icons.
//
// THE ONE FILE WITH COLOUR CODES: the folder's two yellows, its grey and the document types' bands are hex here, as named constants on `fill` attributes, because they are the
// platform's picture of a folder (and of a kind of document), not theme colours: they do not change in dark mode, as Windows' yellow folder does not. Nothing else in the Directory
// writes a colour code; every other colour is a --ds token (kitRules.ts: no hex in a class name), and the status dot takes the platform's own status tone (lib/status.ts TONE). Every icon is decoration (aria-hidden): the name, the type and the status are
// always said in words next to it or in its tooltip, never by colour alone.
import { TONE } from '@/lib/status';
import { statusTone } from './directoryFiles';

/** The folder: the back panel (with its tab), the front panel, and the grey pair of a unit that is switched off. */
export const FOLDER_BACK = '#E9A91C';
export const FOLDER_FRONT = '#FFD35C';
export const FOLDER_GREY_BACK = '#98A1AD';
export const FOLDER_GREY_FRONT = '#C7CDD5';
/** The mark on a folder: a unit's "has its own defaults" badge (white tick on the primary token's disc) needs one white. */
const WHITE = '#FFFFFF';

/** The band on a document's page, by the kind of document; anything else is the last. */
export const TYPE_BAND: Record<string, string> = {
  policy: '#3F6FD8',
  standard: '#7B4FD0',
  procedure: '#1E9A78',
  guideline: '#D8832A',
  charter: '#5C6B7E',
  framework: '#128FB8',
};
export const OTHER_BAND = '#7A8494';
export const bandOf = (type: string): string => TYPE_BAND[type] ?? OTHER_BAND;

interface FolderProps {
  /** pixels: 48 in Icons, 16 to 20 in the tree and the rows */
  size: number;
  /** the folder is the one you are in: its front panel leans back */
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

interface FileProps {
  size: number;
  /** the document's kind (policy, standard, procedure, guideline, ...): the colour of its band */
  type: string;
  /** the document's status: the dot at the corner (the word is in the tooltip, never the colour alone) */
  status?: string;
  title?: string;
  className?: string;
}

export function FileIcon({ size, type, status, title, className }: FileProps) {
  const marks = size >= 32;
  return (
    <svg aria-hidden focusable="false" viewBox="0 0 48 48" width={size} height={size} className={className ?? 'shrink-0'}>
      {title && <title>{title}</title>}
      <path d="M11 4.5h17.2L39 15.3V42a2.5 2.5 0 0 1-2.5 2.5h-25A2.5 2.5 0 0 1 9 42V7a2.5 2.5 0 0 1 2-2.5Z" className="fill-ds-surface stroke-ds-border-strong" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M28 4.8v7.5a3 3 0 0 0 3 3h7.8" fill="none" className="stroke-ds-border-strong" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14.5 21h14M14.5 25.5h19" className="stroke-ds-border-strong" strokeWidth="2" strokeLinecap="round" fill="none" />
      <rect x="14" y="31" width="20" height="8" rx="1.8" fill={bandOf(type)} />
      {marks && status && <circle cx="38" cy="38" r="6.2" fill={TONE[statusTone(status)].dot} stroke={WHITE} strokeWidth="2" />}
    </svg>
  );
}
