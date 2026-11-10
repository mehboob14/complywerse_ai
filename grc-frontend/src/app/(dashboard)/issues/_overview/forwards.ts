// Where an OLD address of /issues goes now (forwards.test.ts), apart from React. /issues used to be a page of eight tabs held in state, opened by ?tab=<id>, by the "issues of this record" address
// (?source_type=risk&source_id=7), by the SCF record link (?issue=<id>) and by the audit-register switch (?register=audit). Three tabs became pages of their own, the settings tabs became
// /issues/settings, and the register switch lives on /issues/register. A person with one of those addresses saved lands where the thing now is; every other parameter rides along. The
// Overview itself (no parameter, ?tab=overview, ?tab=closure) is not a forward.
import { linkedValue, parseLinked } from '../../../../lib/issues/words.ts';

interface Target { path: string; pairs: Array<[string, string]>; anchor?: string }

/** The tabs that became pages, and where each goes (the pages are issues/register, issues/actions and issues/settings). */
const TABS: Record<string, Target> = {
  log: { path: '/issues/register', pairs: [] },
  contract: { path: '/issues/register', pairs: [['category', 'contract']] },
  capa: { path: '/issues/actions', pairs: [] },
  register: { path: '/issues/register', pairs: [] },                       // the old audit-register tab: it opens the audit register unless the address already chose one (below)
  severity_matrix: { path: '/issues/settings', pairs: [] },
  classification_matrix: { path: '/issues/settings', pairs: [] },
  automation: { path: '/issues/settings', pairs: [], anchor: 'automation' },
};

// the parameters this function consumes: they are not copied to the new address
const CONSUMED = ['tab', 'source_type', 'source_id', 'issue'];

// a colon and a comma are legal in a query and are how the registers write a record (linked=risk:7) and a list (severity=critical,high)
const enc = (s: string): string => encodeURIComponent(s).replace(/%3A/gi, ':').replace(/%2C/gi, ',');

/** The address an old /issues address stands for, or null when it is the Overview. `search` is the query string with or without the "?". */
export function forwardFor(search: string): string | null {
  const params = new URLSearchParams(search);
  const issue = /^\d{1,9}$/.exec(params.get('issue') ?? '');
  const linked = parseLinked(`${params.get('source_type') ?? ''}:${params.get('source_id') ?? ''}`);
  const tab = params.get('tab') ?? '';

  let target: Target | null = null;
  if (issue && Number(issue[0]) > 0) target = { path: `/issues/${Number(issue[0])}`, pairs: [] };
  else if (linked) target = { path: '/issues/register', pairs: [['linked', linkedValue(linked)]] };
  else if (Object.prototype.hasOwnProperty.call(TABS, tab)) target = TABS[tab];
  else if (params.has('register') || params.has('source')) target = { path: '/issues/register', pairs: [] };          // the audit-register switch and its source filter
  if (!target) return null;

  const pairs = target.pairs.slice();
  params.forEach((value, key) => { if (!CONSUMED.includes(key) && !pairs.some(([k]) => k === key)) pairs.push([key, value]); });
  if (tab === 'register' && !linked && !issue && !pairs.some(([k]) => k === 'register')) pairs.push(['register', 'audit']);
  const query = pairs.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
  return `${target.path}${query ? `?${query}` : ''}${target.anchor ? `#${target.anchor}` : ''}`;
}
