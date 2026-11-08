// What the details of a library framework say, apart from React so `node --test` can pin them (overviewModel.test.ts). The library stores several fields as free JSON (certification levels,
// the adoption approach, the required artifacts): the old overview page printed a stray object as JSON text (`JSON.stringify(step)`) and invented a default artifact list and a fixed
// "Certification Lifecycle" row when a framework had none. Here a field says what the framework holds, as plain words, or nothing: never raw data, never a made-up default.
import type { LibraryItem } from './hubModel.ts';

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const readable = (key: string): string => { const t = key.replace(/[_-]+/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };

/** One free-form item as a line: a string as it is; an object by its name / title / description, else its values joined; nothing usable is dropped. */
export function lineOf(item: unknown): string {
  const plain = text(item);
  if (plain) return plain;
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const o = item as Record<string, unknown>;
    const head = text(o.name) || text(o.title) || text(o.step) || text(o.phase);
    const body = text(o.description) || text(o.details) || text(o.detail);
    if (head && body && head !== body) return `${head}: ${body}`;
    if (head || body) return head || body;
    return Object.keys(o).map((k) => text(o[k])).filter(Boolean).join(' · ');
  }
  return '';
}

/** A list the library stored as an array, an object of key -> value, or one string: its lines. */
export function linesOf(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(lineOf).filter(Boolean);
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).map((k) => { const v = lineOf((value as Record<string, unknown>)[k]); return v ? `${readable(k)}: ${v}` : readable(k); }).filter(Boolean);
  const one = text(value);
  return one ? [one] : [];
}

/** The certification levels, by name ("Level 2" for a nameless one, as the old page said). */
export function levelNames(levels: unknown): string[] {
  if (!Array.isArray(levels)) return [];
  return levels.map((level, i) => text(level) || text((level as { name?: unknown } | null)?.name) || (level ? `Level ${i + 1}` : '')).filter(Boolean);
}

export interface OverviewSections {
  purpose: string;
  scope: string;
  audience: string;
  objectives: string[];
  approach: string[];
  artifacts: string[];
  levels: string[];
  validity: string;
  penalty: string;
  reasoning: string;
}

/** Every section of a framework's details that it has something for. */
export function overviewOf(fw: LibraryItem): OverviewSections {
  return {
    purpose: text(fw.framework_purpose),
    scope: text(fw.framework_scope),
    audience: text(fw.target_audience),
    objectives: linesOf(fw.framework_objectives),
    approach: linesOf(fw.adoption_approach),
    artifacts: linesOf(fw.required_artifacts),
    levels: levelNames(fw.certification_levels),
    validity: text(fw.certification_validity_period),
    penalty: text(fw.penalty_for_non_compliance),
    reasoning: text(fw.classification_reasoning),
  };
}

/** The version as a person says it. It arrives as "v2024", "2022" or a whole name ("Regulation (EU) 2022/2554"). */
export const versionLabel = (version: string | null | undefined): string | null => {
  const v = (version ?? '').trim();
  return v ? (/^\d/.test(v) ? `v${v}` : v) : null;                    // "2022" is v2022; "v2024" and "Regulation (EU) 2022/2554" are said as they are
};
