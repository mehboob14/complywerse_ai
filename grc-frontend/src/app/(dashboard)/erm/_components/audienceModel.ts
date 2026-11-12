// The Risk Management Overview per audience (wave 3-K): which view opens, and how a measure reads.
// The rows come from GET /erm/dashboard/audience (backend/grc/modules/erm/routers/audience_dashboard.py).
import type { Metric, Section } from '../../../../components/dashboard/erm/types.ts';
import { formatMoney } from '../incidents/lossEvents.ts';

export type AudienceView = 'board' | 'team' | 'owner' | 'audit' | 'third_party';

export const AUDIENCE_VIEWS: ReadonlyArray<{ value: AudienceView; label: string }> = [
  { value: 'board', label: 'Board / CRO' },
  { value: 'team', label: 'Risk team' },
  { value: 'owner', label: 'Risk owner' },
  { value: 'audit', label: 'Internal audit' },
  { value: 'third_party', label: 'Third-party risk' },
];

/** Who counts as the risk team (2nd line): people who may edit the register. Everyone else opens on their own items. */
export const RISK_TEAM_PERMISSIONS = ['erm:risks:edit', 'risks:risk_register:edit'];

export const NOT_TRACKED = 'Not tracked yet';

export interface CurrencyQuarters { currency: string | null; this_quarter: number; last_quarter: number }

export interface AudienceRow {
  key: string;
  label: string;
  definition: string;
  visual: string;
  link: string;
  /** null only when the data behind the measure does not exist yet (`reason` says why). */
  value: number | CurrencyQuarters[] | null;
  reason: string | null;
  items?: Array<Record<string, unknown>>;
  numerator?: number;
  denominator?: number;
  target?: number;
  note?: string;
  checked?: string[];
  bands?: Record<string, number>;
  cells?: { inherent: HeatmapCell[]; residual: HeatmapCell[] };
}

export interface AudiencePayload {
  view: AudienceView;
  title: string;
  as_of: string;
  questions: Array<{ question: string; rows: AudienceRow[] }>;
  programme?: ProgrammePayload;
}

export interface ProgrammePayload {
  sections: Record<string, {
    key: string; label: string; weight: number; score: number | null;
    metrics: Array<{ key: string; label: string; weight: number; score: number | null; numerator: number; denominator: number; formula: string }>;
  }>;
  attention_queue: Record<string, number>;
  performance: { score: number | null; grade: string | null };
}

export interface HeatmapCell { likelihood: number; impact: number; count: number }

export function isAudienceView(value: unknown): value is AudienceView {
  return AUDIENCE_VIEWS.some((v) => v.value === value);
}

/** The view that opens: the person's last choice, else the risk team view for the risk team and the owner view for others. */
export function initialView(stored: string | null, isRiskTeam: boolean): AudienceView {
  if (isAudienceView(stored)) return stored;
  return isRiskTeam ? 'team' : 'owner';
}

const storageKey = (userId: number | null) => `erm-overview-audience:${userId ?? 'me'}`;

/** localStorage, or undefined on the server or where reaching it throws (blocked site data). */
export function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** The last choice of this person; null when storage is blocked (private window, previews) or empty. */
export function readStoredView(storage: Pick<Storage, 'getItem'> | undefined, userId: number | null): string | null {
  try {
    return storage?.getItem(storageKey(userId)) ?? null;
  } catch {
    return null;
  }
}

export function storeView(storage: Pick<Storage, 'setItem'> | undefined, userId: number | null, view: AudienceView): void {
  try {
    storage?.setItem(storageKey(userId), view);
  } catch {
    // remembering the choice is a convenience: blocked storage just means the default view next time
  }
}

function isCurrencyList(value: AudienceRow['value']): value is CurrencyQuarters[] {
  return Array.isArray(value);
}

/** The headline a measure shows: "Not tracked yet", a percent, a score, net loss per currency, or a count. */
export function formatRowValue(row: Pick<AudienceRow, 'value' | 'visual' | 'denominator'>): string {
  const { value } = row;
  if (value === null || value === undefined) return NOT_TRACKED;
  if (isCurrencyList(value)) {
    if (!value.length) return 'No losses booked';
    return value.map((t) => formatMoney(t.this_quarter, t.currency)).join(' · ');
  }
  if (row.visual === 'score_card') return `${Math.round(value)} / 100`;
  if (row.denominator !== undefined) return `${value}%`;
  return value.toLocaleString();
}

/** A drill-down that leaves the page; in-page anchors (the score popup, the self-approval list) have none. */
export function drillHref(row: Pick<AudienceRow, 'link'>): string | null {
  return row.link && !row.link.startsWith('/erm#') ? row.link : null;
}

/** "+8", "-3", "No change", or "—" when there is no approved review to compare with. */
export function changeLabel(change: number | null | undefined): string {
  if (change === null || change === undefined) return '—';
  if (change === 0) return 'No change';
  const rounded = Math.round(change * 10) / 10;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/** Bar widths in percent of the largest value (all zero when every value is zero). */
export function barWidths(values: number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 ? Math.round((v / max) * 100) : 0));
}

/** Rows: likelihood 5→1 (top→bottom). Columns: impact 1→5 (left→right). */
export function toMatrix(cells: HeatmapCell[] | undefined): number[][] {
  const matrix = Array.from({ length: 5 }, () => Array<number>(5).fill(0));
  (cells || []).forEach((c) => {
    if (c.likelihood >= 1 && c.likelihood <= 5 && c.impact >= 1 && c.impact <= 5) {
      matrix[5 - c.likelihood][c.impact - 1] = c.count;
    }
  });
  return matrix;
}

const SECTION_ORDER = ['register', 'assessments', 'rcsa', 'controls', 'vendor_risk', 'kris', 'appetite', 'mitigation',
  'reviews', 'incidents'];
export const TOTAL_SECTIONS = SECTION_ORDER.length;

/** The section-score payload as the Overview's score cards take it. */
export function toSections(programme: ProgrammePayload | undefined): Section[] {
  return SECTION_ORDER
    .map((key) => programme?.sections?.[key])
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({
      key: s.key,
      label: s.label,
      weight: s.weight,
      score: s.score,
      metrics: s.metrics.map((m): Metric => ({
        key: m.key, label: m.label, score: m.score, weight: m.weight,
        count: m.denominator ? `${m.numerator}/${m.denominator}` : '—', formula: m.formula,
      })),
    }));
}
