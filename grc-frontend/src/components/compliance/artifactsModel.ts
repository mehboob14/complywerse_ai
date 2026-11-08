// What the Artifacts tab knows, as plain functions (no React), so `node --test` can pin it: the catalogue narrowed by stage and search and grouped by stage,
// the shortlist "suggested for this control", which formats a download offers and what the file is called. The tab is components/compliance/ArtifactsTab.tsx.

export interface CatalogItemLite {
  id: number;
  name: string;
  stage: string;
  artifact_type: string;
  control_ref: string | null;
  description: string | null;
  is_platform_native: boolean;
}

/** One entry of a framework's artifact catalogue, as the server lists it. */
export interface CatalogItem extends CatalogItemLite {
  artifact_id: string;
  stage_number: number | null;
  mandatory: boolean;
  format: string | null;
  owner: string | null;
  platform_data_type: string | null;
  /** Evidence items this artifact provides (only the per-requirement list returns it, for catalogues built from evidence, e.g. UAE IA). */
  provides?: string[];
  /** Ready = a document or template was generated for it (the server keeps it in artifact_content.json). content_format = markdown | table | guide. */
  has_content?: boolean;
  content_format?: string | null;
}

/** A written copy a person made from a catalogue entry (or from nothing). */
export interface TenantArtifact {
  id: number;
  catalog_item_id: number | null;
  assessment_id: number | null;
  framework_key: string;
  name: string;
  artifact_type: string;
  stage: string | null;
  control_ref: string | null;
  description: string | null;
  format: string | null;
  content: string | null;
  file_name: string | null;
  status: string;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  created_by_name: string | null;
  is_platform_native: boolean;
  platform_data_type: string | null;
  platform_record_count: number | null;
  created_at: string;
  updated_at: string | null;
}

export interface TenantUser { id: number; label: string; email: string | null }

export interface CatalogData { framework_key: string | null; framework_name: string | null; items: CatalogItem[]; stages: string[] }

export const FORMAT_LABEL: Record<string, string> = { xlsx: 'Excel (.xlsx)', csv: 'CSV (.csv)', docx: 'Word (.docx)', pdf: 'PDF (.pdf)', md: 'Markdown (.md)' };

/** The formats a catalogue entry can be downloaded in: a table as a spreadsheet, anything else as a document. */
export function formatsForMode(contentFormat?: string | null): string[] {
  return (contentFormat || '').toLowerCase() === 'table' ? ['xlsx', 'csv', 'pdf', 'md'] : ['docx', 'pdf', 'md'];
}

/** The formats a written artifact can be downloaded in, from the format it declares ("XLSX / CSV" is a table). */
export function formatsForArtifact(format?: string | null): string[] {
  const p = (format || '').toUpperCase().split('/')[0].trim();
  return p === 'XLSX' || p === 'CSV' ? ['xlsx', 'csv', 'pdf', 'md'] : ['docx', 'pdf', 'md'];
}

/** The file a live platform artifact is saved as. */
export const liveExportName = (name: string | null | undefined): string => `${(name || 'artifact').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}.xlsx`;

/** UAE IA marks a document Mandatory when its control is always applicable, not because the standard names the document. */
export const mandatoryNote = (frameworkKey: string): string | undefined =>
  frameworkKey === 'uae_ia' ? 'Its control always applies; the standard does not name the document itself' : undefined;

/** "Stage 3: Risk Assessment" -> "Risk Assessment". */
export const stageName = (stage: string | null | undefined): string => (stage || '').replace(/Stage \d+:\s*/, '');

/** The catalogue narrowed by stage ("all" keeps every stage) and by a search over the name and the description. */
export function filterCatalog<T extends CatalogItemLite>(items: T[], stage: string, query: string): T[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    const inStage = stage === 'all' || item.stage === stage;
    const found = !q || item.name.toLowerCase().indexOf(q) >= 0 || (item.description ? item.description.toLowerCase().indexOf(q) >= 0 : false);
    return inStage && found;
  });
}

export interface StageGroup<T> { stage: string; items: T[] }

/** The entries grouped by stage in the order the server lists the stages (then any stage it did not list, as it came). */
export function groupByStage<T extends { stage: string }>(items: T[], stages: string[]): Array<StageGroup<T>> {
  const groups = new Map<string, T[]>();
  stages.forEach((s) => groups.set(s, []));
  items.forEach((it) => { const g = groups.get(it.stage); if (g) g.push(it); else groups.set(it.stage, [it]); });
  return Array.from(groups.entries()).filter(([, list]) => list.length > 0).map(([stage, list]) => ({ stage, items: list }));
}

/** How many entries each stage has in the whole catalogue (the filter chips and the group headers say the same numbers). */
export function stageCounts(items: Array<{ stage: string }>): Record<string, number> {
  const c: Record<string, number> = {};
  items.forEach((i) => { c[i.stage] = (c[i.stage] || 0) + 1; });
  return c;
}

/** Entries that already have a written copy, by the catalogue id they were made from. */
export function createdByCatalogId<A extends { catalog_item_id: number | null }>(artifacts: A[]): Map<number, A> {
  const m = new Map<number, A>();
  artifacts.forEach((a) => { if (a.catalog_item_id) m.set(a.catalog_item_id, a); });
  return m;
}

// "Suggested for this control": rank the templates by the meaningful words they share with the control's text. There is no exact control-to-artifact key,
// so this is a best-effort shortlist, not a one-to-one map.
const STOP = new Set([
  'data', 'personal', 'pdpl', 'control', 'controls', 'assessment', 'evidence', 'procedure',
  'procedures', 'completed', 'records', 'record', 'documented', 'document', 'documents',
  'policy', 'policies', 'process', 'processing', 'organization', 'organisation', 'these',
  'their', 'must', 'with', 'that', 'this', 'from', 'have', 'will', 'which', 'based', 'nature',
  'activities', 'activity', 'ensure', 'should', 'requirements', 'requirement', 'register',
]);

export function suggestedFor<T extends CatalogItemLite>(items: T[], relevanceText: string | undefined, max = 3): T[] {
  const tokens = new Set(((relevanceText || '').toLowerCase().match(/[a-z]{4,}/g) || []).filter((t) => !STOP.has(t)));
  if (tokens.size === 0) return [];
  return items
    .map((it) => {
      const hay = `${it.name} ${it.description ?? ''} ${it.control_ref ?? ''} ${it.artifact_type}`.toLowerCase();
      const words = new Set(hay.match(/[a-z]{4,}/g) ?? []);
      let score = 0;
      tokens.forEach((t) => { if (words.has(t)) score += 1; });
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.it);
}

/** The first line with something on it: a written artifact's preview. */
export const firstLine = (content: string | null | undefined): string => (content || '').split('\n').find((l) => l.trim()) || '';

/** "risk register" for platform_data_type "risk_register". */
export const dataTypeWords = (t: string | null | undefined): string => (t || '').replace(/_/g, ' ');
