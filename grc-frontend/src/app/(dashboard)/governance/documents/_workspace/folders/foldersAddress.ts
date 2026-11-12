// The Properties popup's place in the library's address, and where the old Directory's addresses go (`/governance/documents/directory`), apart from React so `node --test` can pin them
// (foldersAddress.test.ts). The popup is `?props=<unit>|org&tab=<tab>`: the library's own `?open=` is the details drawer of a DOCUMENT, so the unit's popup has names of its own. The folder the
// library is opened into is the library's own Department filter (`?dept=<unit>`), so it is not here. The two names are a schema of their own (not the library's: PARAM_KEYS is the library's
// filters, its layout and its sort), which the library's address writes leave alone.
import { oneOf, text } from '../../../../../../lib/addressState.ts';
import { ORG_PARAM, TAB_IDS, type TabId } from './directoryModel.ts';

export const PROPS_SCHEMA = { props: text(), tab: oneOf<TabId>(TAB_IDS, 'details') };

type Query = Record<string, string | string[] | undefined> | undefined;
const first = (q: Query, name: string): string => {
  const v = q?.[name];
  return ((Array.isArray(v) ? v[0] : v) ?? '').trim();
};
const unitId = (raw: string): string => (/^\d{1,9}$/.test(raw) ? raw : '');

/**
 * The query of the library's address for an old Directory address. The Directory is gone: its folders are the library's Folders layout. `?unit=<id>` (the folder you were in) is the Department filter,
 * `?open=<id>|org&tab=<tab>` (a unit's Properties) is `?props=...&tab=...`, `?view=icons|details` is dropped. An id that is not a number, an unknown tab and any other name are left out.
 */
export function directoryQuery(query: Query): string {
  const out = new URLSearchParams({ view: 'folders' });
  const unit = unitId(first(query, 'unit'));
  if (unit) out.set('dept', unit);
  const open = first(query, 'open');
  const popup = open.toLowerCase() === ORG_PARAM ? ORG_PARAM : unitId(open);
  if (popup) {
    out.set('props', popup);
    const tab = first(query, 'tab').toLowerCase();
    if ((TAB_IDS as readonly string[]).includes(tab) && tab !== 'details') out.set('tab', tab);
  }
  return `?${out.toString()}`;
}
