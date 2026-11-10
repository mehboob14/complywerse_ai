// Monitoring > Dependencies, apart from React (`dependenciesModel.test.ts`): who relies on what. It is the Technology page (what suppliers run, from outside) and the Concentration page (platforms
// several suppliers share, known-exploited flaws they share, suppliers nobody has recorded) in one place, with the platform names that fold the many spellings of one platform.
// The numbers (how many suppliers use a platform, how many are critical, which flaws hit more than one) are the server's; this file orders and words them.
import { signalSeverity } from '../../../../lib/statuses/vendorMonitoring.ts';

export const VIEWS = ['technology', 'platforms', 'vulnerabilities', 'unregistered'] as const;
export type DepView = (typeof VIEWS)[number];

export const VIEW_LABEL: Readonly<Record<DepView, string>> = {
  technology: 'Technology', platforms: 'Shared platforms', vulnerabilities: 'Shared vulnerabilities', unregistered: 'Not in the register',
};

/** The view an address names; the old Concentration page's own words work too. Anything else is Technology, the page the module's entry used to open. */
export function viewFrom(raw: string | null | undefined): DepView {
  const word = String(raw ?? '').trim().toLowerCase();
  if ((VIEWS as readonly string[]).includes(word)) return word as DepView;
  if (word === 'concentration') return 'platforms';
  return 'technology';
}

const CVE = /^cve-\d{4}-\d{4,7}$/i;
/** A CVE id typed in the search box ("cve-2024-3400") as the id the server wants, or null. */
export const cveOf = (query: string): string | null => (CVE.test(query.trim()) ? query.trim().toUpperCase() : null);

export interface Tech { name: string; category: string; vendors: number; critical: number; versions: string[] }
export interface Catalogue { items: Tech[]; categories: string[]; scanned: number; suppliers: number }
export interface Who {
  name: string; platform: string | null;
  items: Array<{
    vendor: { id: number; name: string; tier: string | null };
    seen: Array<{ name: string; versions: string[]; hosts: string[]; evidence: string | null; at: string }>;
    fourth_parties: Array<{ name: string; service: string | null; critical: boolean }>;
  }>;
}
export interface Shows {
  id: string; scanned: number;
  items: Array<{ vendor: { id: number; name: string; tier: string | null }; hosts: string[]; severity: string; cvss: number | null; waived: boolean; at: string }>;
}
export interface Platform {
  platform: string; vendor_count: number; critical_count: number; direct_vendor_id: number | null;
  vendors: Array<{ id: number; name: string; tier: string | null; via: string[]; critical_dependency: boolean }>;
}
export interface SharedVuln {
  cve: string; title: string | null; severity: string; occurred_at: string | null;
  vendors: Array<{ id: number; name: string; tier: string | null; signal_id: number; acknowledged: boolean }>;
}
export interface Alias { id: number; alias: string; platform: string | null; excluded: boolean }
export interface Shadow { name: string; asset_count: number; products: string[]; sources: string[] }

/** Flaws that hit more than one supplier first (that is the concentration), then the single ones; each group keeps the server's order. */
export function sharedFirst(vulns: readonly SharedVuln[]): SharedVuln[] {
  return vulns.filter((v) => v.vendors.length > 1).concat(vulns.filter((v) => v.vendors.length <= 1));
}

export const severityLabel = (word: string | null | undefined): string => signalSeverity.label(word || 'medium');

/** A supplier on a platform: its name, and that it is a critical dependency there (said in words, not a colour). */
export const dependantLabel = (v: { name: string; critical_dependency: boolean }): string => (v.critical_dependency ? `${v.name} · critical dependency` : v.name);

/** What an alias says: "AWS means Amazon Web Services" or "Acme Ltd is not counted". */
export const aliasSays = (a: Pick<Alias, 'alias' | 'platform' | 'excluded'>): string => (a.excluded ? `“${a.alias}” is not counted` : `“${a.alias}” means ${a.platform ?? 'another name'}`);

/** Intake with the request dialog open for a name found on our own estate. Intake opens its dialog from `request=1`; `name` is for it to prefill. */
export const requestHref = (name: string): string => `/vendor-risk/intake?request=1&name=${encodeURIComponent(name.trim())}`;

/** "Found by": the discovery sources of a supplier nobody recorded, in words. */
export const foundBy = (s: Pick<Shadow, 'asset_count' | 'sources'>): string => `${s.asset_count} ${s.asset_count === 1 ? 'asset' : 'assets'}${s.sources.length ? ` · ${s.sources.join(', ')}` : ''}`;

/** What dismissing a discovered supplier does, said before it is done: the alias that excludes the name also stops it counting as a shared platform. */
export const DISMISS_SAYS = 'It is hidden from this list, and the name is left out of the shared platforms count. You can bring it back under Platform names.';
