// One way to turn a saved ReportSpec into columns and rows.
//
// Three surfaces need this: the builder, the print/PDF view, and dashboard
// tiles. They had been drifting — the print view still fetched through the
// module list API for every dataset, so a server-mode register printed only
// what that API returned and none of the SQL filtering the builder had
// applied. A dashboard would have been the third copy, so the pipeline lives
// here instead.
//
// ponytail: ReportBuilder still owns its own memos over these same pieces
// because it layers builder-only state on top (draft filters, count-column
// fallback, summarize). It consumes the functions below rather than
// re-implementing them; folding its memos in too is a follow-up, not a
// prerequisite.

import type {
  ColumnDef, FilterRules, ReportDataset, ReportSpec, Row, ServerQuery, SortSpec,
} from './types';
import { asRows, rowMatchesRules, rowMatchesSearch } from './grid-utils.ts';
import { isClientSideFilter } from './filter-utils.ts';
import { isActiveCondition } from './grid-utils.ts';
import { queryServer } from './serverApi.ts';
import {
  allLinkageColumns, enrichReportRows, linkageKeysForFields, linkagePresenceColumns,
  presenceTarget, type LinkageDef,
} from './linkages.ts';
import { buildCalcColumns, type CalcColumnDef } from './calcColumns.ts';

export const LINKAGE_OPS = new Set(['linked', 'notlinked']);
/** One page of the build pass, and the most rows it will hold in the browser. */
export const SERVER_BUILD_PAGE = 500;
export const SERVER_BUILD_CAP = 5000;

/** A `linkpresence_<target>` gap filter also resolves in SQL — see
 *  reporting_router._link_presence_condition. It goes to BOTH sides: the server
 *  narrows the register (so "risks with no evidence" is exact rather than
 *  capped at the build page), and the same condition stays in the client rules
 *  as a re-check, because the server skips it for client-mode datasets and for
 *  pairs with no join edge, reporting that in `warnings.skipped_filters`. */
export const isLinkPresence = (c: { col: string; op: string }) =>
  c.col.startsWith('linkpresence_') && LINKAGE_OPS.has(c.op);

/** Split rules into SQL-safe vs post-enrich client filters.
 *  OR + any client filter → run everything client-side (server can't partial-OR). */
export function partitionServerFilters(
  rules: FilterRules,
  resolveCol?: (key: string) => ColumnDef | undefined,
): { serverFilters: { col: string; op: string; value: string }[]; clientRules: FilterRules; allClient: boolean } {
  const active = rules.conditions.filter(isActiveCondition);
  const client = active.filter((c) => isClientSideFilter(c.col, c.op, resolveCol));
  const server = active.filter(
    (c) => !isClientSideFilter(c.col, c.op, resolveCol) || isLinkPresence(c),
  );
  if (client.length > 0 && rules.logic === 'OR') {
    return {
      serverFilters: [],
      clientRules: { logic: rules.logic, conditions: active },
      allClient: true,
    };
  }
  return {
    serverFilters: server.map((c) => ({ col: c.col, op: c.op, value: c.value })),
    clientRules: { logic: rules.logic, conditions: client },
    allClient: false,
  };
}

/** Fetch all server pages (filters/search applied in SQL).
 *  Client-only filters (gaps, link counts, enriched names) apply after enrich. */
export async function fetchServerBuildRows(
  datasetKey: string,
  rules: FilterRules,
  search: string,
  sorts: SortSpec[],
  resolveCol?: (key: string) => ColumnDef | undefined,
): Promise<{ rows: Row[]; total: number }> {
  const { serverFilters } = partitionServerFilters(rules, resolveCol);
  const out: Row[] = [];
  let total = 0;
  let skip = 0;
  while (skip < SERVER_BUILD_CAP) {
    const body: ServerQuery = {
      dataset: datasetKey,
      skip,
      limit: SERVER_BUILD_PAGE,
      search: search.trim() || undefined,
      sorts: (sorts || []).map((s) => ({ key: s.key, dir: s.dir })),
      filters: serverFilters,
      logic: rules.logic,
    };
    const page = await queryServer(body);
    total = page.total;
    out.push(...asRows(page.rows));
    if (out.length >= page.total || page.rows.length < SERVER_BUILD_PAGE) break;
    skip += SERVER_BUILD_PAGE;
  }
  // `total` is what the query matched; `out` is what we could hold. Any
  // client-side pass over these rows — gap counts, link totals, chart tiles —
  // describes only the part we fetched, so the caller has to say so.
  return { rows: out, total };
}

export interface ResolvedReport {
  /** Real fields a calculation or filter may reference (no calculations). */
  sourceCols: ColumnDef[];
  /** Fields that evaluate off a row: dataset + enriched links + calculations. */
  cols: ColumnDef[];
  /** Everything addressable by key, for labels and stale references. */
  lookupCols: ColumnDef[];
  /** Linkage targets that must be enriched for this spec. */
  includes: string[];
  /** Foreign-module fields to project during enrichment. */
  projectFields: string[];
}

/** Columns and enrichment plan for one spec. Pure — no fetching. */
export function resolveReportColumns(
  spec: ReportSpec,
  dataset: ReportDataset | undefined,
  catalog: LinkageDef[],
  extraFieldKeys: string[] = [],
): ResolvedReport {
  if (!dataset) {
    return { sourceCols: [], cols: [], lookupCols: [], includes: [], projectFields: [] };
  }
  const linkageColDefs = allLinkageColumns(catalog);
  const presenceCols = linkagePresenceColumns(catalog);
  const sourceCols = [...dataset.columns, ...linkageColDefs];
  const calcDefs = (spec.calcColumns ?? []) as CalcColumnDef[];
  const calcCols = buildCalcColumns(calcDefs, (k) => sourceCols.find((c) => c.key === k));

  const fieldKeys = Array.from(new Set<string>([
    ...(spec.visibleColumns ?? []),
    ...spec.rules.conditions.map((c) => c.col),
    ...(spec.measures ?? []).map((m) => m.key).filter(Boolean),
    ...(spec.rows ?? []),
    // A calculation reads its operands, which may live in another module.
    ...calcDefs.flatMap((d) => [d.a, d.b].filter((k): k is string => !!k)),
    ...extraFieldKeys,
  ]));

  const includes = Array.from(new Set([
    ...linkageKeysForFields(fieldKeys, catalog),
    // A "(not) linked to any X" filter must enrich X so its count exists.
    ...fieldKeys.map(presenceTarget).filter((t): t is string => !!t),
    ...(spec.includes ?? []),
  ]));

  const inc = new Set(includes);
  const cols = [
    ...dataset.columns,
    ...linkageColDefs.filter((c) => c.linkageKey && inc.has(c.linkageKey)),
    ...presenceCols.filter((c) => c.linkageKey && inc.has(c.linkageKey)),
    ...calcCols,
  ];

  const seen = new Set<string>();
  const lookupCols: ColumnDef[] = [];
  for (const c of [...sourceCols, ...calcCols, ...presenceCols]) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    lookupCols.push(c);
  }

  return {
    sourceCols,
    cols,
    lookupCols,
    includes,
    projectFields: fieldKeys.filter((k) => k.startsWith('xmod_')),
  };
}

/** Fetch the rows one spec describes, through SQL where the dataset supports
 *  it. Returns `total` so the caller can say when the cap bit. */
export async function loadReportRows(
  spec: ReportSpec,
  dataset: ReportDataset,
  plan: Pick<ResolvedReport, 'includes' | 'projectFields' | 'lookupCols'>,
  opts: { forceClientFetch?: boolean } = {},
): Promise<{ rows: Row[]; total: number; truncated: boolean }> {
  const resolve = (k: string) => plan.lookupCols.find((c) => c.key === k);
  let rows: Row[];
  let total: number;
  if (dataset.server && !opts.forceClientFetch) {
    const page = await fetchServerBuildRows(
      dataset.key, spec.rules, spec.search, spec.sorts ?? [], resolve,
    );
    rows = page.rows;
    total = page.total;
  } else {
    rows = asRows(await dataset.fetch());
    total = rows.length;
  }
  if (plan.includes.length && rows.length) {
    rows = await enrichReportRows(dataset.key, rows, plan.includes, plan.projectFields);
  }
  return { rows, total, truncated: total > rows.length };
}

/** The filtering the browser still owes after SQL has done its part. */
export function filterReportRows(
  cols: ColumnDef[],
  rows: Row[],
  spec: ReportSpec,
  serverMode: boolean,
  resolveCol?: (key: string) => ColumnDef | undefined,
): Row[] {
  const { clientRules, allClient } = partitionServerFilters(spec.rules, resolveCol);
  return rows.filter((r) => {
    if (serverMode) {
      return rowMatchesRules(cols, r, allClient ? spec.rules : clientRules);
    }
    return rowMatchesSearch(cols, r, spec.search) && rowMatchesRules(cols, r, spec.rules);
  });
}
