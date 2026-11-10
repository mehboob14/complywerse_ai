// How an answer's sources read on screen: the name of the kind of source, its title, a short extract, and a link to the record when the page is known.
// Never the type key, the internal id or a relevance score (rule U1). Pure, so `node --test` pins it and checks every link against the navigation registry.
import type { ChatSource } from './chatModel.ts';

export interface SourceView {
  key: string;
  /** "Document", "Evidence", "Your file", "Platform records" */
  label: string;
  title: string;
  /** a short extract, or '' */
  snippet: string;
  /** the record's page, or null when there is none to open */
  href: string | null;
  kind: 'live_data' | 'record' | 'your_file';
}

/** The pages a record opens on, by the type the server names it with. Only types whose id is the id that page takes (checked against the code). */
const PAGES: Record<string, (id: string) => string> = {
  governance_document: (id) => `/governance/documents/${id}`,
  evidence_file: (id) => `/evidence/${id}`,
  grc_compliance_assessment: (id) => `/compliance/assessments/${id}`,
};

/** The types that have a page, for the test that every link resolves. */
export const LINKED_TYPES = Object.keys(PAGES);

const humanise = (key: string): string => {
  const words = key.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Source';
};

const clip = (s: string, max: number): string => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, '').trimEnd()}…`;
};

export function viewOfSource(source: ChatSource, index: number): SourceView {
  const type = source.entity_type ?? '';
  const id = source.entity_id == null ? '' : String(source.entity_id);
  const kind: SourceView['kind'] = source.kind === 'live_data' || source.framework_code === 'Live Data' ? 'live_data' : source.kind === 'your_file' || type === 'chat_upload' ? 'your_file' : 'record';
  const page = Object.prototype.hasOwnProperty.call(PAGES, type) ? PAGES[type] : undefined;       // not a key of Object.prototype ("constructor")
  const label = kind === 'live_data' ? 'Platform records' : kind === 'your_file' ? 'Your file' : (source.label ?? '').trim() || humanise(type);
  return {
    key: `${type}:${id}:${index}`,
    label,
    title: clip(source.control_name ?? '', 140) || label,
    snippet: kind === 'live_data' ? '' : clip(source.snippet ?? '', 220),
    href: page && /^\d+$/.test(id) ? page(id) : null,
    kind,
  };
}

/** The sources of an answer: each record once, in the order the server ranked them. */
export function viewsOf(sources: readonly ChatSource[] | undefined): SourceView[] {
  const seen = new Set<string>();
  const out: SourceView[] = [];
  (sources ?? []).forEach((s, i) => {
    const v = viewOfSource(s, i);
    const same = `${s.entity_type ?? ''}:${s.entity_id ?? ''}`;
    if (s.entity_id && seen.has(same)) return;
    if (s.entity_id) seen.add(same);
    out.push(v);
  });
  return out;
}

/** "Sources (3)" */
export const sourcesLabel = (n: number): string => `Sources (${n})`;
