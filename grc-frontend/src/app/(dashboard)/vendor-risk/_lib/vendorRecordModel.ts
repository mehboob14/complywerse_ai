// What the vendor record page works out from its address and its data: which tab an address names (the old tab keys still work),
// who is tiered, which engagement a button is for, when the next review falls, how often a tier is reviewed, how far a lifecycle
// is. Pure, so `node --test` runs vendorRecordModel.test.ts against it (the kit's own files are imported with .ts).

import { parseUtc } from '../../../../lib/serverTime.ts';
import { fmt } from '../_ui/fmt.ts';
import type { Tone } from '../_ui/tones.ts';

// ── tabs ─────────────────────────────────────────────────────────────────────

export const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'lifecycle', label: 'Lifecycle' },
  { key: 'assessments', label: 'Assessments' },
  { key: 'findings', label: 'Findings' },
  { key: 'paperwork', label: 'Paperwork' },
  { key: 'monitoring', label: 'Monitoring' },
] as const;
export type TabKey = (typeof TABS)[number]['key'];

// The twelve tabs of before, and the tab that now holds each one's content.
const LEGACY: Record<string, TabKey> = {
  engagements: 'overview', dependencies: 'overview',
  portal: 'assessments', exposure: 'assessments',
  actions: 'findings',
  sla: 'paperwork',
  'outside-in': 'monitoring', incidents: 'monitoring',
};

/** The tab an address names. A link to one finding goes to the Findings tab, a link to a stage to the Lifecycle (a link that names
 *  both, like `?stage=findings&finding=3`, is about the finding); then `?tab=`, old keys included; anything else is the Overview. */
export function tabFor(q: { tab?: string | null; stage?: string | null; finding?: string | null }): TabKey {
  if (q.finding && Number.isFinite(Number(q.finding))) return 'findings';
  if (q.stage) return 'lifecycle';
  const key = String(q.tab ?? '').trim().toLowerCase();
  return TABS.find((t) => t.key === key)?.key ?? LEGACY[key] ?? 'overview';
}

/** `?finding=` as a number, or null when it is not one. */
export const findingFrom = (raw?: string | null): number | null => {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
};

/** The address of a vendor's page, with the parameters that have a value, in the order given. */
export function recordHref(vendorId: number, params: Record<string, string | number | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') q.set(key, String(value));
  const text = q.toString();
  return `/vendor-risk/vendors/${vendorId}${text ? `?${text}` : ''}`;
}

/** Where "Tier engagement" and "Re-tier" go: the Lifecycle tab, which opens its tiering popup for `tier=1` (and the engagement). */
export const tierHref = (vendorId: number, engagementId: number | null) =>
  recordHref(vendorId, { tab: 'lifecycle', tier: 1, engagement: engagementId });

export const lifecycleHref = (vendorId: number, engagementId: number | null) =>
  recordHref(vendorId, { tab: 'lifecycle', engagement: engagementId });

// ── engagements ──────────────────────────────────────────────────────────────

/** What the page needs of an engagement row (General is the supplier itself: its id is null until the first engagement is added). */
export interface Scope {
  id: number | null;
  is_general?: boolean;
  name?: string;
  status?: string;
  tier?: string | null;
  inherent_risk_score?: number | null;
  next_reassessment_date?: string | null;
  reassessment_cadence_days?: number | null;
}

export const openScopes = <T extends Scope>(items?: T[]): T[] => (items ?? []).filter((e) => e.status !== 'ended');

/** Tiered means a tier was worked out: an inherent score. `Vendor.tier` alone is not a decision (a request or Shadow SaaS seeds "medium"). */
export const isTiered = (row?: { inherent_risk_score?: number | null } | null): boolean => row?.inherent_risk_score != null;

/** The engagement the page picked, as the lifecycle and the Assessments tab take it: its id, or null for General. An id the supplier
 *  has no open engagement for (ended, or a stale link) is General; until the list has loaded the id is taken as given. */
export function pickEngagement(items: Scope[] | undefined, raw: number | null): number | null {
  if (!raw) return null;
  if (!items) return raw;
  return openScopes(items).some((e) => !e.is_general && e.id === raw) ? raw : null;
}

/** Which engagement "Tier engagement" is for: the one picked when it has no tier, else the first one in use that has none, else the
 *  one picked. null is General. */
export function tierTarget(items: Scope[] | undefined, picked: number | null): number | null {
  const open = openScopes(items);
  const mine = open.find((e) => (picked ? e.id === picked : e.is_general));
  if (mine && !isTiered(mine)) return picked;
  const first = open.find((e) => !isTiered(e));
  return first ? (first.is_general ? null : first.id) : picked;
}

/** Whether the engagement `tierTarget` names already has a tier (its button then says Re-tier). */
export function targetTiered(items: Scope[] | undefined, target: number | null): boolean {
  const row = openScopes(items).find((e) => (target ? e.id === target : e.is_general));
  return isTiered(row);
}

// ── dates ────────────────────────────────────────────────────────────────────

/** Days from `today` to a stored date, counted in calendar days the way `fmt.countdown` counts them: a date with no time is that day as
 *  written, a moment is the viewer's own day. null when there is no date. */
export function daysUntil(value?: string | null, today: Date = new Date()): number | null {
  const at = parseUtc(value);
  if (!at) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
    : Date.UTC(at.getFullYear(), at.getMonth(), at.getDate());
  return Math.round((day - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000);
}

/** A `datetime-local` value ("2026-10-29T14:30", the viewer's own time) as the server keeps times: naive UTC, no zone. */
export function localToServer(local: string): string {
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? local : at.toISOString().slice(0, 19);
}

export const DUE_SOON_DAYS = 30;

/** The pill of a review date: red once it has passed, amber in the month before, green otherwise. null when there is no date. */
export function reviewClock(value?: string | null, today: Date = new Date()): { tone: Tone; label: string } | null {
  const days = daysUntil(value, today);
  if (days == null) return null;
  if (days < 0) return { tone: 'danger', label: `Overdue ${fmt.countdown(value, today)}` };
  return { tone: days <= DUE_SOON_DAYS ? 'warning' : 'success', label: `Due ${fmt.countdown(value, today)}` };
}

/** The earliest review among the engagements in use; `fallback` (the supplier's own date) when the list is not there. */
export function nextReview(items: Scope[] | undefined, fallback?: string | null): string | null {
  const dates = items ? openScopes(items).map((e) => e.next_reassessment_date).filter((d): d is string => !!d) : [fallback ?? ''];
  const stamped = dates.map((d) => ({ d, at: parseUtc(d)?.getTime() })).filter((x): x is { d: string; at: number } => x.at != null);
  return stamped.length ? stamped.reduce((a, b) => (b.at < a.at ? b : a)).d : null;
}

/** "every 6 months", "every year", "every 45 days": a number of days in the words that read best. */
export function cadenceLabel(days?: number | null): string {
  if (!days || days <= 0) return 'not set';
  if (days % 365 === 0) return days === 365 ? 'every year' : `every ${days / 365} years`;
  if (days % 30 === 0) return days === 30 ? 'every month' : `every ${days / 30} months`;
  return `every ${days} days`;
}

/** How often an engagement is reviewed: its own cadence when it has set one, else what the policy says for its tier. */
export function cadenceFor(scope: Pick<Scope, 'tier' | 'reassessment_cadence_days'>, policy?: Record<string, number> | null): number | null {
  if (scope.reassessment_cadence_days) return scope.reassessment_cadence_days;
  return (scope.tier && policy?.[String(scope.tier).toLowerCase()]) || null;
}

// ── lifecycle ────────────────────────────────────────────────────────────────

/** How many of a lifecycle's stages are settled: complete, or skipped by policy. null while there are none to count. */
export function settled(stages?: Array<{ status: string }> | null): { done: number; total: number } | null {
  if (!stages || stages.length === 0) return null;
  return { done: stages.filter((s) => s.status === 'complete' || s.status === 'skipped').length, total: stages.length };
}

// ── the vendor's own facts ───────────────────────────────────────────────────

/** Where the record came from: through the request flow, or put on the register directly (by hand, by import, from Shadow SaaS). */
export const sourceLabel = (v?: { intake_status?: string | null } | null): string => (v?.intake_status ? 'Onboarding request' : 'Added directly');

export function classificationTone(value?: string | null): Tone {
  const key = String(value ?? '').trim().toLowerCase();
  return key === 'restricted' ? 'danger' : key === 'confidential' ? 'warning' : 'neutral';
}

/** The scores a vendor carries, on one line: "Inherent 61.2 · Residual 33.4 · Medium"; "Not scored" before there are any. */
export function riskLine(v?: { inherent_risk_score?: number | null; residual_risk_score?: number | null; risk_rating?: string | null } | null): string {
  const n = (x?: number | null) => (typeof x === 'number' && Number.isFinite(x) ? String(Math.round(x * 10) / 10) : null);
  const parts = [n(v?.inherent_risk_score) && `Inherent ${n(v?.inherent_risk_score)}`, n(v?.residual_risk_score) && `Residual ${n(v?.residual_risk_score)}`,
    v?.risk_rating ? fmt.status(v.risk_rating) : null];
  return parts.filter(Boolean).join(' · ') || 'Not scored';
}

/** The meta line under a vendor's name: type, industry, business unit (the website is a link of its own). */
export function metaParts(v?: { vendor_type?: string | null; industry?: string | null; business_unit?: { name?: string | null } | null } | null): string[] {
  return [v?.vendor_type, v?.industry, v?.business_unit?.name].map((p) => String(p ?? '').trim()).filter(Boolean);
}

/** A website as a link target ("acme.example" gets https://), or null when it is not one. */
export function webHref(website?: string | null): string | null {
  const text = String(website ?? '').trim();
  if (!text) return null;
  const web = /^https?:\/\//i.test(text);
  if (!web && /^[a-z][a-z0-9+.-]*:(?!\d+(\/|$))/i.test(text)) return null;      // another scheme (javascript:, mailto:, ftp://); "host:8080" is a port
  const href = web ? text : `https://${text}`;
  return /^https?:\/\/[^\s/]+/i.test(href) ? href : null;
}

/** The website as people say it: no scheme, no "www.", no path. */
export const webHost = (website?: string | null): string =>
  String(website ?? '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];

/** What a vendor shares with us: the data types as chips; else a note ("Personal data, types not itemised" or "None recorded"). */
export function dataShared(v?: { data_types_accessed?: string[] | null; holds_personal_data?: boolean | null } | null): { chips: string[]; note: string | null } {
  const chips = (v?.data_types_accessed ?? []).map((t) => String(t).trim()).filter(Boolean);
  if (chips.length) return { chips, note: null };
  return { chips: [], note: v?.holds_personal_data ? 'Personal data, types not itemised' : 'None recorded' };
}

/** The note that goes with a renewal request, from what is known of the document: "Our copy of X expires on 1 Dec 2026. Please upload the current one." */
export function renewalNote(d: { name: string; state?: string | null; ends_on?: string | null }): string {
  const end = d.ends_on ? fmt.date(d.ends_on) : null;
  const when = d.state === 'expired' ? (end ? `expired on ${end}` : 'has expired') : end ? `expires on ${end}` : 'is about to expire';
  return `Our copy of ${d.name} ${when}. Please upload the current one.`;
}

/** A contact's line in the right column: "Security · dana@acme.example · +44 20 7946 0000" (the primary flag is a mark of its own). */
export function contactLine(c: { roles?: string[] | null; email?: string | null; phone?: string | null }): string {
  const roles = (c.roles ?? []).filter((r) => r !== 'primary').map((r) => fmt.status(r));
  return [roles.join(', '), c.email, c.phone].filter(Boolean).join(' · ') || 'No details';
}
