import psl from 'psl';

/**
 * Registrable ("apex") domain for a hostname, resolved via the full Public
 * Suffix List (the `psl` package) — the universal source of truth, so this is
 * correct for EVERY TLD/ccTLD/private suffix without hand-maintained lists:
 *
 *   www.zambeel.lums.edu.pk → lums.edu.pk     foo.co.uk        → foo.co.uk
 *   www.liztek.ca           → liztek.ca       app.github.io    → app.github.io
 *                                             x.s3.amazonaws.com → x.s3.amazonaws.com
 *
 * Returns '' for anything that isn't a groupable hostname (empty, single-label,
 * an IP address, or a host:port) so callers can skip grouping on it.
 */
export function registrableDomain(host: string): string {
  const h = (host || '').toLowerCase().replace(/\.$/, '').trim();
  if (!h || !h.includes('.') || h.includes(':') || /^[\d.]+$/.test(h)) return '';
  try {
    return (psl.get(h) || '').toLowerCase();
  } catch {
    return '';
  }
}

/** The DNS name an asset is known by — fqdn first, then host_name, then name. */
export const dnsName = (a: { fqdn?: string | null; host_name?: string | null; name?: string | null }): string =>
  (a?.fqdn || a?.host_name || a?.name || '').toLowerCase().replace(/\.$/, '').trim();

/** THE single source of truth for external-vs-internal on the client (mirrors the
 *  backend grc.modules.it_assets.asset_rollup.is_external). External = internet-facing
 *  (or the legacy is_internet_facing) OR EASM-discovered OR last seen outside-in;
 *  everything else is internal. `mode`/`asset_type` are NOT used — they mislabelled
 *  internet-facing web targets as internal. */
export const isExternalAsset = (a: {
  internet_facing?: boolean | null; is_internet_facing?: boolean | null;
  origin_source?: string | null; last_seen_source?: string | null;
}): boolean =>
  !!(a?.internet_facing || a?.is_internet_facing || a?.origin_source === 'easm' || a?.last_seen_source === 'external');

/** Roll-up bucket an external asset counts under: its registrable (apex) domain
 *  when groupable, else a per-asset key so a bare IP / single-label host is its
 *  own unit and never silently merged with another. */
export function externalUnitKey(a: { id?: number | string }, name?: string): string {
  const apex = registrableDomain(name ?? dnsName(a as any));
  return apex || `id:${(a && a.id) ?? ''}`;
}

export type RollupCounts = { total: number; external: number; internal: number; subCounts: Map<string, number> };

/**
 * Canonical reconciled asset counts — the SINGLE rule every dashboard and the
 * Asset Register share (mirrors the backend grc.modules.it_assets.asset_rollup):
 * ONE registrable (apex) domain = ONE external asset, with its subdomains rolled
 * up under it; internal assets are never rolled up. So `external` is the number
 * of distinct apex domains (+ non-groupable external hosts), NOT the flat
 * subdomain count, and `total` = external + internal.
 *
 * `isExt` / `nameOf` are injectable so a surface can keep its own external
 * predicate or name accessor; both default to the register's rule.
 */
export function rollupCounts(
  assets: any[],
  isExt: (a: any) => boolean = isExternalAsset,
  nameOf: (a: any) => string = dnsName,
): RollupCounts {
  const units = new Map<string, number>();
  let internal = 0;
  for (const a of assets || []) {
    if (!isExt(a)) { internal += 1; continue; }
    const k = externalUnitKey(a, nameOf(a));
    units.set(k, (units.get(k) ?? 0) + 1);
  }
  const subCounts = new Map<string, number>();
  units.forEach((n, k) => { if (n > 1 && !k.startsWith('id:')) subCounts.set(k, n - 1); });
  return { external: units.size, internal, total: units.size + internal, subCounts };
}

/**
 * The LIST form of {@link rollupCounts}: one entry per logical asset — every
 * internal asset, plus ONE representative per external apex (its subdomains
 * folded away). `out.length === rollupCounts(...).total`. Use this (not the raw
 * array) to compute register facet counts, so every filter chip counts the same
 * rolled-up unit the register's total does — otherwise a chip ("Infrastructure
 * 12") can exceed the folded total ("6"). The apex row itself is preferred as
 * the representative when present, else the first subdomain seen.
 */
export function rollupAssets(
  assets: any[],
  isExt: (a: any) => boolean = isExternalAsset,
  nameOf: (a: any) => string = dnsName,
): any[] {
  const repIdx = new Map<string, number>(); // apex key -> index in out
  const out: any[] = [];
  for (const a of assets || []) {
    if (!isExt(a)) { out.push(a); continue; }
    const k = externalUnitKey(a, nameOf(a));
    const seen = repIdx.get(k);
    if (seen === undefined) { repIdx.set(k, out.length); out.push(a); continue; }
    // Already have a representative for this apex. Promote THIS row to the
    // representative if it is the apex itself (keeps the register's apex row).
    const name = nameOf(a);
    if (name && name === registrableDomain(name)) out[seen] = a;
  }
  return out;
}
