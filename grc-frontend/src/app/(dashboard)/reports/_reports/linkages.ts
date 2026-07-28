import apiClient from '@/lib/api';
import type { ColumnDef, ReportDataset, Row } from './types';
import { buildOpenLinkageCatalog, mergeLinkageCatalogs } from './openCatalog';

export interface LinkageFieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'badge';
  agg?: 'sum' | 'avg';
}

export interface LinkageDef {
  key: string;
  label: string;
  module: string;
  fields: LinkageFieldDef[];
  hasEdge?: boolean;   // a real join edge exists base→this module (orphan filters are meaningful)
}

/** Build the open catalog (all modules / all columns) and merge any server extras. */
export async function fetchLinkageCatalog(
  dataset: string,
  datasets?: ReportDataset[],
): Promise<LinkageDef[]> {
  const open = datasets?.length ? buildOpenLinkageCatalog(dataset, datasets) : [];
  try {
    const r = await apiClient.get<{ linkages: LinkageDef[] }>('/reporting/linkages', { params: { dataset } });
    // The server marks which targets have a real join edge (snake_case has_edge);
    // carry it as hasEdge so only meaningful modules get orphan filters.
    const server = (r.data.linkages || []).map((l) => ({
      ...l,
      hasEdge: (l as { has_edge?: boolean }).has_edge ?? l.hasEdge,
    }));
    if (open.length) return mergeLinkageCatalogs(open, server);
    return server;
  } catch {
    return open;
  }
}

export async function enrichReportRows(
  dataset: string,
  rows: Row[],
  includes: string[],
  project: string[] = [],
): Promise<Row[]> {
  if (!includes.length || !rows.length) return rows;
  const r = await apiClient.post<{ rows: Row[] }>('/reporting/enrich', {
    dataset,
    rows,
    includes,
    project,
  });
  return r.data.rows || rows;
}

function fieldToColumn(def: LinkageDef, f: LinkageFieldDef): ColumnDef {
  return {
    key: f.key,
    label: f.label,
    type: f.type || 'text',
    width: f.type === 'number' ? 110 : 220,
    align: f.type === 'number' ? 'right' : 'left',
    agg: f.agg,
    linkageKey: def.key,
    linkageModule: def.module,
  };
}

/** All linkage columns from the catalog (for the column picker). */
export function allLinkageColumns(catalog: LinkageDef[]): ColumnDef[] {
  const out: ColumnDef[] = [];
  for (const def of catalog) {
    for (const f of def.fields) out.push(fieldToColumn(def, f));
  }
  return out;
}

/** Columns for enabled linkage modules only (legacy helper). */
export function linkageColumns(catalog: LinkageDef[], includes: string[]): ColumnDef[] {
  const out: ColumnDef[] = [];
  for (const inc of includes) {
    const def = catalog.find((l) => l.key === inc);
    if (!def) continue;
    for (const f of def.fields) out.push(fieldToColumn(def, f));
  }
  return out;
}

/** Which linkage modules must be enriched for the given field keys. */
export function linkageKeysForFields(fieldKeys: string[], catalog: LinkageDef[]): string[] {
  const keys = new Set<string>();
  const fieldSet = new Set(fieldKeys.filter(Boolean));
  for (const link of catalog) {
    if (link.fields.some((f) => fieldSet.has(f.key))) keys.add(link.key);
  }
  return Array.from(keys);
}

/** The linkage target key behind a `linkpresence_<key>` filter column, or null. */
export function presenceTarget(fieldKey: string): string | null {
  return fieldKey.startsWith('linkpresence_') ? fieldKey.slice('linkpresence_'.length) : null;
}

/** Filterable "is (not) linked to any <module>" pseudo-columns — offered ONLY for
 *  modules with a real join edge, so "not linked" means genuinely orphaned rather
 *  than always-zero. The accessor reads the enriched link count; the builder
 *  includes/enriches the target whenever such a condition is active. */
export function linkagePresenceColumns(catalog: LinkageDef[]): ColumnDef[] {
  return catalog
    .filter((d) => d.hasEdge)
    .map((d) => ({
      key: `linkpresence_${d.key}`,
      label: `Linked: ${d.label}`,
      type: 'linkage' as const,
      linkageKey: d.key,
      linkageModule: d.module,
      accessor: (row: Row): number => {
        const n = Number((row as Record<string, unknown>)[`link_${d.key}_count`] ?? 0);
        return Number.isFinite(n) ? n : 0;
      },
    }));
}
