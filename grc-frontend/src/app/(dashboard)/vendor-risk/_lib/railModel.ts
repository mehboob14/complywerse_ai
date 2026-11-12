// The module's rail (its left menu), kept short on purpose: eight entries in the order the work flows (a vendor is requested, assessed, watched and
// reported on). Pages that belong together share one entry and a strip of tabs above the page, so nothing needs a rail entry of its own:
// a vendor's lifecycle, assessments, questionnaires sent and contracts live on its record (Vendors > record); the lists across every vendor
// sit behind Vendors' tabs. Pure, so `node --test` runs railModel.test.ts against it; layout.tsx draws it.

import type { Counts } from './portfolioModel';

export interface RailTab { name: string; href: string }

export interface RailEntry {
  key: string;
  name: string;
  /** where the rail link goes (the first tab, when there are tabs) */
  href: string;
  /** a page that belongs to this entry without being one of its tabs (a drill-down reached from a card) */
  also?: string[];
  tabs?: RailTab[];
  /** the number the rail shows beside it (what waits there), from the module's counts */
  count?: keyof Counts;
  waiting?: string;
}

const V = '/vendor-risk';

export const RAIL: RailEntry[] = [
  { key: 'overview', name: 'Overview', href: V, also: [`${V}/attention`, `${V}/actions`] },
  { key: 'vendors', name: 'Vendors', href: `${V}/vendors`, tabs: [
    { name: 'Register', href: `${V}/vendors` },
    { name: 'Assessments', href: `${V}/assessments` },
    { name: 'Contracts', href: `${V}/contracts` },
    { name: 'Check-ins', href: `${V}/reviews` },
  ] },
  { key: 'intake', name: 'Intake', href: `${V}/intake`, count: 'intake_pending', waiting: 'pending' },
  { key: 'findings', name: 'Findings', href: `${V}/findings`, count: 'open_findings', waiting: 'open' },
  { key: 'questionnaires', name: 'Questionnaires', href: `${V}/questionnaires` },
  { key: 'monitoring', name: 'Monitoring', href: `${V}/monitoring`, tabs: [
    { name: 'Signals', href: `${V}/monitoring` },
    { name: 'Breach alerts', href: `${V}/alerts` },
    { name: 'Security ratings', href: `${V}/security` },
    { name: 'Technology', href: `${V}/technology` },
    { name: 'Concentration', href: `${V}/concentration` },
  ] },
  { key: 'insights', name: 'Insights', href: `${V}/risk-360`, tabs: [
    { name: 'Risk 360°', href: `${V}/risk-360` },
    { name: 'Loss quantification', href: `${V}/comply-analysis` },
    { name: 'Reports', href: `${V}/reports` },
    { name: 'Shared assessments', href: `${V}/exchange` },
  ] },
  { key: 'setup', name: 'Setup', href: `${V}/roster`, tabs: [
    { name: 'Roster', href: `${V}/roster` },
    { name: 'Policy', href: `${V}/policy` },
    { name: 'Settings', href: `${V}/settings` },
  ] },
];

const clean = (pathname: string): string => (pathname || '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
const under = (path: string, href: string): boolean => path === href || path.startsWith(`${href}/`);

/** Whether a tab (or an entry's own page) is the one on: its page and the pages beneath it. */
export const tabActive = (pathname: string, href: string): boolean => under(clean(pathname), href);

/** The rail entry a page belongs to: its own page, a tab's page or a page beneath one. The Overview is `/vendor-risk` itself only. */
export function entryOf(pathname: string): RailEntry | undefined {
  const path = clean(pathname);
  return RAIL.find((e) => {
    if (e.key === 'overview') return path === V || (e.also || []).some((h) => under(path, h));
    return (e.tabs || [{ name: e.name, href: e.href }]).some((t) => under(path, t.href)) || (e.also || []).some((h) => under(path, h));
  });
}
