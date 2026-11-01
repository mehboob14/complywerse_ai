// What the Evidence workspace keeps in its address, so a reload, the Back button and a link land where the person was (workspaceAddress.test.ts):
//   /evidence?view=pipeline&status=pending_review,draft&evidence_type=policy&q=firewall&open=42&page=2&section=settings
// The names are the ones the server's own list uses where it has one (`status`, `evidence_type`). `type`, `control` and `control_id` are NOT used: other
// pages link to /evidence with those (control-library gaps, the controls workbench) and this page has never read them, so they stay ignored.
import { integer, listOf, oneOf, text } from '../../../../lib/addressState.ts';
import { STATUS_VALUES } from './evidenceModel.ts';

/** The five views. The switcher offers the first three; Register and Performance are built but were taken out of the switcher, and open from the address. */
export const VIEW_KEYS = ['workbench', 'pipeline', 'snapshot', 'register', 'performance'] as const;
export type ViewKey = (typeof VIEW_KEYS)[number];
export const OFFERED_VIEWS: readonly ViewKey[] = ['workbench', 'pipeline', 'snapshot'];

export const SCHEMA = {
  view: oneOf(VIEW_KEYS, 'workbench'),
  /** Records (the workspace) or Settings (the shared module-settings panel) */
  section: oneOf(['records', 'settings'] as const, 'records'),
  q: text(),
  status: listOf(STATUS_VALUES),
  evidence_type: listOf(),
  /** the file selected in the workbench / open in the preview (0: none) */
  open: integer(0, { min: 1 }),
  page: integer(1, { min: 1 }),
};
