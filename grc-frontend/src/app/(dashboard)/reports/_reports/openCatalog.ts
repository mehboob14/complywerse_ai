// Open-ended cross-module column catalog.
// Every permitted dataset (except the current base) exposes ALL of its columns
// so users can pull any field into any report — not just curated link aggregates.

import type { ReportDataset } from './types';
import type { LinkageDef, LinkageFieldDef } from './linkages';

/** Namespaced key for a foreign module column on a report row. */
export function xmodKey(datasetKey: string, fieldKey: string): string {
  return `xmod_${datasetKey}__${fieldKey}`;
}

export function parseXmodKey(key: string): { dataset: string; field: string } | null {
  if (!key.startsWith('xmod_')) return null;
  const rest = key.slice(5);
  const i = rest.indexOf('__');
  if (i <= 0) return null;
  return { dataset: rest.slice(0, i), field: rest.slice(i + 2) };
}

/** Build an open linkage catalog: every other dataset → all of its columns. */
export function buildOpenLinkageCatalog(
  baseKey: string,
  datasets: ReportDataset[],
): LinkageDef[] {
  return datasets
    .filter((d) => d.key !== baseKey)
    .map((d) => {
      const fields: LinkageFieldDef[] = [
        // Handy aggregates (filled when a join edge exists)
        { key: `link_${d.key}_count`, label: `${d.label} (count)`, type: 'number', agg: 'sum' },
        { key: `link_${d.key}_names`, label: `Linked ${d.label.toLowerCase()}`, type: 'text' },
        { key: `link_${d.key}_open_count`, label: `Open ${d.label.toLowerCase()} (count)`, type: 'number', agg: 'sum' },
        // Every real column from that module
        ...d.columns.map((c) => ({
          key: xmodKey(d.key, c.key),
          label: c.label,
          type: (c.type || 'text') as LinkageFieldDef['type'],
          agg: c.agg,
        })),
      ];
      return {
        key: d.key,
        label: d.label,
        module: d.module,
        fields,
      };
    });
}

/** Merge server catalog + open catalog (open fields win on key collisions). */
export function mergeLinkageCatalogs(open: LinkageDef[], server: LinkageDef[]): LinkageDef[] {
  const byKey = new Map<string, LinkageDef>();
  for (const s of server) {
    byKey.set(s.key, { ...s, fields: [...s.fields] });
  }
  for (const o of open) {
    const existing = byKey.get(o.key);
    if (!existing) {
      byKey.set(o.key, o);
      continue;
    }
    const seen = new Set(existing.fields.map((f) => f.key));
    const merged = [...existing.fields];
    for (const f of o.fields) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      merged.push(f);
    }
    byKey.set(o.key, { ...existing, label: o.label || existing.label, module: o.module || existing.module, fields: merged });
  }
  // Prefer open order (all modules the user can access)
  const ordered: LinkageDef[] = [];
  const used = new Set<string>();
  for (const o of open) {
    const item = byKey.get(o.key);
    if (item) {
      ordered.push(item);
      used.add(o.key);
    }
  }
  for (const [k, v] of Array.from(byKey.entries())) {
    if (!used.has(k)) ordered.push(v);
  }
  return ordered;
}
