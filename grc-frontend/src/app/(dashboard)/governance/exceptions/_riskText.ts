// What the exception details say about potential risks, compensating controls and assets, as plain functions (no React, no @/ imports) so `node --test` runs
// exceptionsDetails.test.ts against them. The server decides all of it (modules/governance/exception_risks.py, exception_controls.py, exception_assets.py);
// this only says it: ratings in the register's words, the organisation's own names for the levels, the risks grouped by round and step, what each control
// covers (always by title or name, never by number), and the forms' drafts turned into what the server takes.
import { formatDate } from '../../../../lib/format.ts';
import { detailText, safeDetail } from '../../../../lib/apiError.ts';
import { statusOf } from '../../../../components/ui/ds/reportOutcome.ts';
import { priority as priorityStatus } from '../../../../lib/status.ts';
import type { Tone } from '../../../../lib/status.ts';
import type { AssetLink, CompensatingControl, ControlInput, PotentialRisk, Rating, RiskInput, RisksTurn } from './_types.ts';

// ─── Ratings and levels ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const LEVELS = [1, 2, 3, 4, 5] as const;

/** The register's own bands (risk_priority_for_score): likelihood x impact of 20 or more is critical, 12 high, 6 medium, else low; null until both levels are set. */
export function ratingOf(likelihood: number | null | undefined, impact: number | null | undefined): Rating | null {
  if (!likelihood || !impact) return null;
  const score = likelihood * impact;
  return score >= 20 ? 'critical' : score >= 12 ? 'high' : score >= 6 ? 'medium' : 'low';
}

/** A rating (or an asset's criticality: the same four words) as a pill: the Governance priority tones; the server's own word when it sent one. */
export function levelPill(word: string | null | undefined, label?: string | null): { tone: Tone; label: string } | null {
  return word ? { tone: priorityStatus.tone(word), label: label || priorityStatus.label(word) } : null;
}

/** "Likelihood Possible · Impact Major" in the organisation's own words when it has set its scales, else "Likelihood 3 · Impact 4"; a level not set is left out. */
export function levelsLine(r: Pick<PotentialRisk, 'likelihood' | 'impact' | 'likelihood_label' | 'impact_label'>): string {
  const part = (name: string, n: number | null, label: string | null) => (n ? `${name} ${label || n}` : '');
  return [part('Likelihood', r.likelihood, r.likelihood_label), part('Impact', r.impact, r.impact_label)].filter(Boolean).join(' · ');
}

export interface ScaleWords { likelihood: Record<number, string>; impact: Record<number, string> }

/** The organisation's names for the five levels (Risk Management > Scales), when it has set them; empty otherwise. */
export function scaleWords(rows: ReadonlyArray<{ scale_type: string; level: number; label: string }> | null | undefined): ScaleWords {
  const out: ScaleWords = { likelihood: {}, impact: {} };
  for (const r of rows ?? []) if ((r.scale_type === 'likelihood' || r.scale_type === 'impact') && r.label) out[r.scale_type][r.level] = r.label;
  return out;
}

/** The options of a likelihood or impact select: 1 to 5, each with the organisation's word for the level when it has one ("3 · Possible"). */
export const levelOptions = (words: Record<number, string> | undefined): Array<{ value: string; label: string }> =>
  LEVELS.map((n) => ({ value: String(n), label: words?.[n] ? `${n} · ${words[n]}` : String(n) }));

// ─── The risks, by round and step ────────────────────────────────────────────────────────────────────────────────────────────────

export interface RiskGroup { key: string; round: number | null; step: number | null; title: string; rows: PotentialRisk[] }
export interface RiskRound { round: number | null; groups: RiskGroup[] }

const groupTitle = (r: Pick<PotentialRisk, 'step_name' | 'step_kind'>): string => (r.step_name ?? '').trim() || (r.step_kind === 'review' ? 'Review' : 'Approval');

/**
 * The risks of the round that counts now, by step in order, and the other rounds (newest first, a round from before approval rules last), each by step. Without a
 * rule there is no round and no step: the rows are one group, "Approval". A row keeps the server's order inside its step.
 */
export function groupRisks(risks: readonly PotentialRisk[], currentRound: number | null): { current: RiskGroup[]; earlier: RiskRound[] } {
  const byRound = new Map<number | null, Map<number | null, PotentialRisk[]>>();
  for (const r of risks) {
    const steps = byRound.get(r.round) ?? new Map<number | null, PotentialRisk[]>();
    steps.set(r.step_position, [...(steps.get(r.step_position) ?? []), r]);
    byRound.set(r.round, steps);
  }
  const groupsOf = (round: number | null): RiskGroup[] => Array.from(byRound.get(round)?.entries() ?? [])
    .sort(([a], [b]) => (a ?? 0) - (b ?? 0))
    .map(([step, rows]) => ({ key: `${round ?? 0}-${step ?? 0}`, round, step, title: groupTitle(rows[0]), rows }));
  const others = Array.from(byRound.keys()).filter((r) => r !== currentRound).sort((a, b) => (b ?? -1) - (a ?? -1));
  return { current: groupsOf(currentRound), earlier: others.map((round) => ({ round, groups: groupsOf(round) })) };
}

export const roundLabel = (round: number | null): string => (round ? `Round ${round}` : 'Earlier');

/**
 * The round that counts now: the approval's own when the person is shown the approval; otherwise (an implementer, whom the server does not show it to, or an exception no
 * rule governed) the newest round the risks were recorded in, and null when none has a round (the older flow).
 */
export function currentRound(risks: readonly Pick<PotentialRisk, 'round'>[], approvalRound: number | null | undefined): number | null {
  if (approvalRound) return approvalRound;
  const rounds = risks.map((r) => r.round).filter((n): n is number => typeof n === 'number');
  return rounds.length > 0 ? Math.max(...rounds) : null;
}

/** "Sara found none" (a row that says the person found none); "You found none" for the person's own. */
export const foundNoneLine = (r: Pick<PotentialRisk, 'mine' | 'recorded_by'>): string => `${r.mine ? 'You' : r.recorded_by.name} found none`;

/** "By Sara" / "By you": who recorded a risk. */
export const byLine = (r: Pick<PotentialRisk, 'mine' | 'recorded_by'>): string => `By ${r.mine ? 'you' : r.recorded_by.name}`;

/** What the person asked has recorded at their open step (their own rows that are still theirs to change). */
export function myAssessment(turn: Pick<RisksTurn, 'recorded' | 'none_identified'> | null, risks: readonly PotentialRisk[]): { recorded: boolean; none_identified: boolean; count: number } {
  return { recorded: Boolean(turn?.recorded), none_identified: Boolean(turn?.none_identified), count: risks.filter((r) => r.mine && r.can_edit && !r.none_identified).length };
}

export function assessmentWord(a: { recorded: boolean; none_identified: boolean; count: number }): { tone: Tone; label: string } {
  if (!a.recorded) return { tone: 'warning', label: 'Not recorded' };
  return { tone: 'success', label: a.none_identified ? 'None identified' : `${a.count} recorded` };
}

/** The risks that are real (a row that says "none identified" is not one), as the controls panel's titles: risk number -> title. */
export function riskTitleMap(risks: readonly Pick<PotentialRisk, 'id' | 'title' | 'none_identified'>[]): Record<number, string> {
  const out: Record<number, string> = {};
  for (const r of risks) if (!r.none_identified && r.title) out[r.id] = r.title;
  return out;
}

/** The risks a control of the round being implemented may cover: the real ones of that round (all of them when the round is not known). */
export const coverableRisks = (risks: readonly PotentialRisk[], round: number | null): PotentialRisk[] =>
  risks.filter((r) => !r.none_identified && r.title && (round === null || r.round === round));

export const assetNameMap = (links: readonly Pick<AssetLink, 'asset_id' | 'name'>[]): Record<number, string> =>
  Object.fromEntries(links.map((a) => [a.asset_id, a.name]));

// ─── The drafts of the risk form ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface RiskDraft { title: string; description: string; likelihood: string; impact: string }
export const emptyRiskDraft = (): RiskDraft => ({ title: '', description: '', likelihood: '', impact: '' });
export const draftOfRisk = (r: Pick<PotentialRisk, 'title' | 'description' | 'likelihood' | 'impact'>): RiskDraft =>
  ({ title: r.title ?? '', description: r.description ?? '', likelihood: r.likelihood ? String(r.likelihood) : '', impact: r.impact ? String(r.impact) : '' });
/** Whether the person has typed or chosen anything: a form like that asks before it is thrown away. */
export const riskDraftTouched = (d: RiskDraft): boolean => Boolean(d.title.trim() || d.description.trim() || d.likelihood || d.impact);
/** What the server takes for a risk (a change sends the empty note and levels too, so a field can be cleared). */
export const riskInput = (d: RiskDraft): RiskInput =>
  ({ title: d.title.trim(), description: d.description.trim(), likelihood: d.likelihood ? Number(d.likelihood) : null, impact: d.impact ? Number(d.impact) : null });

// ─── Compensating controls ───────────────────────────────────────────────────────────────────────────────────────────────────

export function controlWord(status: string): { tone: Tone; label: string } {
  return status === 'in_place' ? { tone: 'success', label: 'In place' } : { tone: 'pending', label: 'Planned' };
}

/** What a control covers, by title and name: a number the map does not know is left out (a person never reads one). */
export function coverNames(c: Pick<CompensatingControl, 'risk_ids' | 'asset_ids'>, risks: Record<number, string>, assets: Record<number, string>): { risks: string[]; assets: string[] } {
  const named = (ids: readonly number[], names: Record<number, string>) => ids.map((i) => names[i]).filter((n): n is string => Boolean(n));
  return { risks: named(c.risk_ids, risks), assets: named(c.asset_ids, assets) };
}

/** "19 Nov 2026" (a day, as written); '' without one. */
export const controlDue = (c: Pick<CompensatingControl, 'due_date'>): string => (c.due_date ? formatDate(c.due_date, { calendar: true }) : '');

export type EvidenceDraft = { kind: 'link'; url: string; label: string } | { kind: 'evidence'; evidenceId: string; label: string };
export interface ControlForm {
  title: string; description: string; riskIds: string[]; assetIds: string[]; ownerId: string | null; due: string; status: 'planned' | 'in_place'; evidence: EvidenceDraft[];
}
export const emptyControlForm = (): ControlForm => ({ title: '', description: '', riskIds: [], assetIds: [], ownerId: null, due: '', status: 'planned', evidence: [] });
export const formOfControl = (c: CompensatingControl): ControlForm => ({
  title: c.title, description: c.description ?? '', riskIds: c.risk_ids.map(String), assetIds: c.asset_ids.map(String), ownerId: c.owner ? String(c.owner.id) : null,
  due: c.due_date ? c.due_date.slice(0, 10) : '', status: c.status,
  evidence: c.evidence.map((ev): EvidenceDraft => (ev.kind === 'link' ? { kind: 'link', url: ev.url, label: ev.label } : { kind: 'evidence', evidenceId: String(ev.evidence_id), label: ev.label })),
});
export const controlFormTouched = (a: ControlForm, b: ControlForm): boolean => JSON.stringify(a) !== JSON.stringify(b);

/** What the server takes for a control. An evidence line the person left empty (no link typed, no item chosen) is not sent. */
export function controlInput(f: ControlForm): ControlInput {
  const evidence = f.evidence
    .filter((ev) => (ev.kind === 'link' ? ev.url.trim() !== '' : ev.evidenceId !== ''))
    .map((ev) => (ev.kind === 'link'
      ? { kind: 'link' as const, url: ev.url.trim(), label: ev.label.trim() || undefined }
      : { kind: 'evidence' as const, evidence_id: Number(ev.evidenceId), label: ev.label.trim() || undefined }));
  return {
    title: f.title.trim(), description: f.description.trim(), risk_ids: f.riskIds.map(Number), asset_ids: f.assetIds.map(Number),
    owner_id: f.ownerId ? Number(f.ownerId) : null, due_date: f.due || null, status: f.status, evidence,
  };
}

/**
 * The options of a list with a name for every value already chosen: a value the list does not hold (a person who left, an evidence item beyond the first page) would
 * be drawn by its number, and a person never reads one. `names` says what such a value is called.
 */
export function withChosen<T extends { value: string; label: string; description?: string }>(
  options: readonly T[], chosen: ReadonlyArray<string | null | undefined>, names: Record<string, string>,
): Array<T | { value: string; label: string }> {
  const have = new Set(options.map((o) => o.value));
  const extra = chosen.filter((v): v is string => Boolean(v) && !have.has(v as string) && Boolean(names[v as string])).map((v) => ({ value: v, label: names[v] }));
  return extra.length > 0 ? [...options, ...extra] : [...options];
}

// ─── Assets ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** "Added by Olivia at the request" / "... at the implementation"; without a person, "Added at the request". */
export function addedLine(a: Pick<AssetLink, 'added_by' | 'stage'>): string {
  const when = a.stage === 'implementation' ? 'at the implementation' : 'at the request';
  return a.added_by ? `Added by ${a.added_by.name} ${when}` : `Added ${when}`;
}

// ─── The question before "Mark implemented" ──────────────────────────────────────────────────────────────────────────────────

/**
 * The server's 409 that asks whether to mark it implemented although some potential risks have no control ("N potential risks have no compensating control: ...
 * Mark it implemented anyway?"), in its own words; null for any other answer (the other 409s are plain refusals and are shown as they are).
 */
export function uncoveredQuestion(error: unknown): string | null {
  if (statusOf(error) !== 409) return null;
  const said = safeDetail(detailText((error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail), 600);
  return /implemented anyway\?$/i.test(said) ? said : null;
}
