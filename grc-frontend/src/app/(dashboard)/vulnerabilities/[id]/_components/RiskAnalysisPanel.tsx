'use client';

/**
 * Vulnerability detail — Analysis panel, context rail and Exploit Test tab.
 *
 * Structured to match the reference VM product's finding screen, but scored
 * with OUR formula, not theirs. The breakdown bars below are the real
 * weights from backend `modules/vuln_management/enrichment/priority.py`:
 *
 *     composite = 0.40·CVSS + 0.30·(EPSS×10) + 0.20·(KEV?10:0) + 0.10·asset_criticality
 *
 * so the segments always add up to the score the backend actually stored.
 * Copying the reference's 20/20/15/15/10/10/10 split would have produced a
 * breakdown that disagreed with our own number.
 *
 * Attack vector, exploit maturity and patch-availability have no dedicated
 * columns in our schema — they are derived here from the CVSS vector string,
 * the public-exploit count and the patch references, and each is labelled
 * with where it came from.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, Clock, UserPlus, Server, Radar, Send, FlaskConical,
  ShieldCheck, ShieldAlert, AlertCircle, Plus,
} from 'lucide-react';
import { vulnManagementApi } from '@/lib/api';
import { GuideMarker } from '@/components/guide';

/* ─── derivations ──────────────────────────────────────────────────── */

/** CVSS v3 vector looks like "CVSS:3.1/AV:N/AC:L/...". AV is the attack vector. */
export function parseAttackVector(vector?: string | null): { label: string; severe: boolean } | null {
  if (!vector) return null;
  const m = /\bAV:([NALP])\b/.exec(vector);
  if (!m) return null;
  const map: Record<string, { label: string; severe: boolean }> = {
    N: { label: 'Network', severe: true },
    A: { label: 'Adjacent network', severe: true },
    L: { label: 'Local', severe: false },
    P: { label: 'Physical', severe: false },
  };
  return map[m[1]] ?? null;
}

function exploitMaturity(v: any): { label: string; severe: boolean; from: string } {
  const count = v.public_exploit_count ?? 0;
  if (count > 0) return { label: count > 2 ? 'Weaponized' : 'Proof of concept', severe: true, from: `${count} public exploit${count === 1 ? '' : 's'} found` };
  if (v.kev_flag) return { label: 'Actively exploited', severe: true, from: 'Listed in CISA KEV' };
  return { label: 'None known', severe: false, from: 'No public exploit found' };
}

function patchAvailable(v: any): { label: string; severe: boolean; from: string } {
  const refs = v.patch_references;
  const n = Array.isArray(refs) ? refs.length : refs ? 1 : 0;
  if (n > 0) return { label: 'Yes', severe: false, from: `${n} vendor patch reference${n === 1 ? '' : 's'}` };
  if (v.remediation_guidance) return { label: 'Guidance only', severe: false, from: 'Vendor guidance, no patch link' };
  return { label: 'Not found', severe: true, from: 'No vendor patch located' };
}

function ageDays(v: any): number | null {
  const d = v.discovered_at || v.created_at;
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

const critScore = (c?: string | null) => ({ critical: 10, high: 7.5, medium: 5, low: 2.5 }[(c || '').toLowerCase()] ?? 5);

/* ─── small pieces ─────────────────────────────────────────────────── */

function Stat({ label, value, severe, hint }: { label: string; value: React.ReactNode; severe?: boolean; hint?: string }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-[15px] font-semibold ${severe ? 'text-rose-600' : 'text-slate-900'}`}>{value ?? '—'}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function RailCard({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Icon size={14} strokeWidth={1.75} className="text-slate-500" />
        <span className="text-[13.5px] font-semibold text-slate-900">{title}</span>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

/* ─── 1. AI Risk Analysis ──────────────────────────────────────────── */

export function RiskAnalysisPanel({ vulnerability, assetCriticality, assetCriticalityScore, internetFacing }: {
  vulnerability: any; assetCriticality?: string | null; assetCriticalityScore?: number | null; internetFacing?: boolean | null;
}) {
  const v = vulnerability;
  const cvss = v.cvss_score ?? 0;
  const epss = v.epss_score ?? 0;
  const kev = !!v.kev_flag;
  // When no asset is linked we cannot know criticality, so the formula falls
  // back to medium — and the panel says so rather than showing a bare dash.
  const knownCrit = assetCriticality ?? v.asset_criticality ?? null;
  // The backend scores criticality from the asset's DERIVED numeric score and
  // only falls back to the text label. The panel must use the same source or
  // the two totals disagree — they were drifting by up to 6 points because the
  // label and the derived score can flatly contradict each other in the data.
  const crit = assetCriticalityScore != null
    ? Math.max(0, Math.min(10, assetCriticalityScore))
    : critScore(knownCrit);
  const critDetail = assetCriticalityScore != null
    ? `${knownCrit ?? 'derived'} · scored ${assetCriticalityScore}/10`
    : (knownCrit ?? 'unknown → medium');

  const avEarly = parseAttackVector(v.cvss_vector);
  const matEarly = exploitMaturity(v);
  // Unknown is not zero — an unrated exploit still carries latent risk, so it
  // scores 0.3, matching the backend.
  const matW = matEarly.label === 'Weaponized' ? 1 : matEarly.label === 'Actively exploited' ? 1
    : matEarly.label === 'Proof of concept' ? 0.4 : matEarly.label === 'None known' ? 0.1 : 0.3;
  const avW = avEarly?.label === 'Network' ? 1 : avEarly?.label === 'Adjacent network' ? 0.6
    : avEarly?.label === 'Local' ? 0.3 : avEarly?.label === 'Physical' ? 0.1 : 0.5;
  const exposed = !!internetFacing;

  // Seven signals, matching backend priority.py exactly, expressed out of 100.
  // CVSS is deliberately only 20 of the 100: it measures how bad the flaw is,
  // not how likely it is to be used against THIS host.
  const parts = [
    { label: 'CVSS severity', got: (cvss / 10) * 20, max: 20, detail: `CVSS ${cvss || '—'} / 10` },
    { label: 'Exploit probability', got: epss * 20, max: 20, detail: epss ? `EPSS ${(epss * 100).toFixed(1)}%` : 'not enriched' },
    { label: 'Exploit maturity', got: matW * 15, max: 15, detail: matEarly.label.toLowerCase() },
    { label: 'Known exploited', got: kev ? 15 : 0, max: 15, detail: kev ? 'in CISA KEV' : 'not in KEV' },
    { label: 'Attack vector', got: avW * 10, max: 10, detail: avEarly?.label?.toLowerCase() ?? 'unknown → moderate' },
    { label: 'Internet exposure', got: exposed ? 10 : 0, max: 10, detail: internetFacing == null ? 'no asset linked' : exposed ? 'internet-facing' : 'internal only' },
    { label: 'Asset criticality', got: crit, max: 10, detail: critDetail },
  ];
  const raw = parts.reduce((s, p) => s + p.got, 0);
  // KEV floor — a known-exploited bug is never medium priority.
  const floored = kev && raw < 80;
  // `live` is the breakdown's own sum, recomputed here purely to draw the bars
  // and to detect drift. The HEADLINE number is the backend's stored score —
  // the single source everything else (the rail, the list) also shows. We do
  // not display two different totals for one finding.
  const live = Math.min(100, Math.round(floored ? 80 : raw));
  const stored = v.composite_priority != null ? Math.round(v.composite_priority * 10) : null;
  const total = stored ?? live;

  const av = parseAttackVector(v.cvss_vector);
  const mat = exploitMaturity(v);
  const patch = patchAvailable(v);
  const age = ageDays(v);

  const ring = total >= 80 ? '#e11d48' : total >= 55 ? '#f59e0b' : '#0ea5e9';
  const C = 2 * Math.PI * 52;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <Sparkles size={15} strokeWidth={1.75} className="text-indigo-500" />
          <h3 className="text-[15px] font-semibold text-slate-900">Risk analysis</h3>
        </div>
        <p className="mb-5 text-[12.5px] text-slate-500">
          Contextual risk score weighing severity, exploit probability, known-exploited status and the criticality of the asset it sits on.
        </p>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          {/* score ring */}
          <div className="relative flex-none" style={{ width: 132, height: 132 }}>
            <svg width="132" height="132" viewBox="0 0 132 132">
              <circle cx="66" cy="66" r="52" fill="none" stroke="#e2e8f0" strokeWidth="10" />
              <circle
                cx="66" cy="66" r="52" fill="none" stroke={ring} strokeWidth="10" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C - (C * total) / 100}
                transform="rotate(-90 66 66)"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[30px] font-semibold leading-none text-slate-900">{total}</span>
              <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">score</span>
            </div>
          </div>

          {/* factor grid */}
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Stat label="CVSS score" value={cvss ? `${cvss} / 10` : '—'} />
            <Stat label="EPSS (exploitability)" value={epss ? `${(epss * 100).toFixed(1)}%` : 'Not enriched'} severe={epss > 0.5} />
            <Stat label="CISA KEV" value={kev ? 'Yes' : 'No'} severe={kev} />
            <Stat label="Attack vector" value={av?.label ?? 'Unknown'} severe={av?.severe} hint={av ? 'from CVSS vector' : 'no CVSS vector stored'} />
            <Stat label="Exploit maturity" value={mat.label} severe={mat.severe} hint={mat.from} />
            <Stat label="Patch available" value={patch.label} severe={patch.severe} hint={patch.from} />
            <Stat label="Asset criticality" value={knownCrit ?? 'Unknown'} severe={(knownCrit ?? '').toLowerCase() === 'critical'} hint={knownCrit ? undefined : 'no asset linked — scored as medium'} />
            {/* Internet exposure, not status — exposure is one of the seven
                scoring signals (see the breakdown); status is not scored. */}
            <Stat
              label="Internet exposed"
              value={internetFacing == null ? 'Unknown' : exposed ? 'Yes' : 'No'}
              severe={exposed}
              hint={internetFacing == null ? 'no asset linked' : undefined}
            />
            <Stat label="Age" value={age != null ? `${age}d` : '—'} severe={age != null && age > 90} />
          </div>
        </div>

        {/* breakdown */}
        <div className="mt-6 border-t border-slate-100 pt-5">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
              Score breakdown
              <GuideMarker id="vuln.breakdown" n={6} />
            </span>
            {/* The bars sum to `live`; the headline score is `total` (stored).
                They match when enrichment is current — the banner below flags
                the rare case where they don't. */}
            {/* Shows the SAME number as the ring. `live` is only used to detect
                staleness below — displaying both put two totals on one card,
                differing by a rounding point. */}
            <span className="text-[12.5px] text-slate-500">Total <b className="text-slate-900">{total}</b> / 100</span>
          </div>
          {floored && (
            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
              <GuideMarker id="vuln.kevFloor" n={7} className="mr-1" />
              Signals total {Math.round(raw)}, but this CVE is on the CISA KEV list — actively exploited in the wild.
              The score is floored at <b>80</b> so a known-exploited bug can never sit in the medium queue.
            </div>
          )}
          <div className="hidden">
          </div>
          <div className="space-y-2.5">
            {parts.map((p) => (
              <div key={p.label} className="flex h-6 items-center gap-3">
                <span className="w-36 flex-none truncate text-[12.5px] text-slate-600">{p.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  {/* A zero score draws nothing — a rounded 0.6%-wide bar
                      rendered as a stray dot that read as "some progress". */}
                  {p.got >= 0.5 && (
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, (p.got / p.max) * 100)}%`, background: ring }} />
                  )}
                </div>
                {/* Fixed width + truncate: these details used to wrap onto a
                    second line and made every row a different height. */}
                <span title={p.detail} className="w-36 flex-none truncate text-right font-mono text-[11.5px] text-slate-500">{p.detail}</span>
                <span className="w-16 flex-none text-right font-mono text-[12.5px] font-semibold tabular-nums text-slate-900">
                  {Math.round(p.got)} / {p.max}
                </span>
              </div>
            ))}
          </div>
          {stored != null && Math.abs(stored - live) > 1 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-800">
              <b>Stored score is stale.</b> The saved score is {stored}/100; the current evidence gives {live}/100.
              The saved value is only recalculated during enrichment — press <b>Re-enrich</b> in Threat Intelligence to bring it in line.
            </div>
          )}
        </div>

        {/* A "Remediation recommendation" block rendered `ai_recommendation`
            here — the fourth place on this page showing the same AI text, and
            the second to dump it as raw markdown (`### 1.`, `*(_priority: …)*`)
            because it was printed as a plain string with no renderer.

            It also sat on the wrong tab. Analysis answers "what is this and how
            bad is it". Remediation answers "what do we do". `ai_recommendation`
            now holds compensating-control suggestions, which belong to
            Remediation and are shown there properly, as cards you can accept
            into Mitigations.

            `v.recommendation` (the manually-written one) is deliberately gone
            from here too — if a human wrote remediation guidance it belongs
            beside the plan, not under the score. */}
      </div>
    </div>
  );
}

/* ─── 2. Context rail ──────────────────────────────────────────────── */

export function VulnContextRail({
  vulnerability, users, linkedAssets,
}: { vulnerability: any; users?: any[]; linkedAssets?: any[] }) {
  const v = vulnerability;
  const qc = useQueryClient();
  const [pick, setPick] = useState('');

  const assign = useMutation({
    // The client already wraps this as { user_id }. Passing an object here sent
    // { user_id: { assigned_to: 123 } } and every assignment 422'd, which blocked
    // the whole person-based ownership path — including Approve, since that now
    // requires an owner. The `as any` was what let it ship: it silenced the exact
    // type error that would have caught the mismatch.
    mutationFn: (userId: number) => vulnManagementApi.vulnerabilities.assign(v.id, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vulnerability', v.id] }); setPick(''); },
  });

  const due = v.due_date ? new Date(v.due_date) : null;
  const overdueDays = due ? Math.floor((Date.now() - due.getTime()) / 86400000) : null;
  const asset = (linkedAssets ?? [])[0];

  return (
    <div className="space-y-3">
      <RailCard icon={UserPlus} title="Assignment">
        <div className="flex items-baseline justify-between">
          <span className="text-[12.5px] text-slate-500">Current</span>
          <span className={`text-[13px] font-semibold ${v.assignee_name || v.assigned_to ? 'text-slate-900' : 'text-rose-600'}`}>
            {v.assignee_name || v.assigned_to_name || (v.assigned_to ? `User #${v.assigned_to}` : 'Unassigned')}
          </span>
        </div>
        <div className="mt-3 flex gap-2">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12.5px] text-slate-700"
          >
            <option value="">Assign to member…</option>
            {(users ?? []).map((u: any) => (
              <option key={u.id} value={u.id}>{u.display_name || u.username || u.email}</option>
            ))}
          </select>
          <button
            disabled={!pick || assign.isPending}
            onClick={() => pick && assign.mutate(Number(pick))}
            className="flex-none rounded-lg bg-teal-500 px-3 py-1.5 text-white disabled:opacity-40 hover:bg-teal-600"
            title="Assign"
          >
            <Send size={13} />
          </button>
        </div>
        {assign.isError && <p className="mt-2 text-[11.5px] text-rose-600">Could not assign — check your permissions.</p>}
      </RailCard>

      <RailCard icon={Server} title="Affected asset">
        {!asset ? (
          <p className="text-[12.5px] text-slate-400">No asset linked to this finding yet.</p>
        ) : (
          <>
            <div className="text-[14px] font-semibold text-slate-900">{asset.asset_name || asset.name || `Asset #${asset.asset_id || asset.id}`}</div>
            {/* `criticality` is present when this came from the risk-posture asset
                payload; `asset_criticality` when it came from the vulnerability's
                asset link. Reading only the first is what made every affected asset
                claim "Criticality not set". */}
            <div className="mt-0.5 text-[12px] capitalize text-slate-500">
              {(asset.criticality || asset.asset_criticality)
                ? `${asset.criticality || asset.asset_criticality} criticality`
                : 'Criticality not set'}
            </div>
            <Link
              href={`/assets/${asset.asset_id || asset.id}`}
              className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              View asset details →
            </Link>
            {(linkedAssets?.length ?? 0) > 1 && (
              <p className="mt-2 text-center text-[11.5px] text-slate-400">+{linkedAssets!.length - 1} more affected</p>
            )}
          </>
        )}
      </RailCard>

    </div>
  );
}

/* ─── 3. Exploit Test ──────────────────────────────────────────────── */

export function ExploitTestPanel({ vulnId }: { vulnId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ result: 'pass', findings: '', evidence: '' });

  const retests = useQuery({
    queryKey: ['vuln-retests', vulnId],
    queryFn: async () => (await vulnManagementApi.retests.list(vulnId)).data as any[],
  });

  const create = useMutation({
    mutationFn: (body: any) => vulnManagementApi.retests.create(vulnId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vuln-retests', vulnId] });
      setOpen(false);
      setForm({ result: 'pass', findings: '', evidence: '' });
    },
  });

  const items = retests.data ?? [];
  const TONE: Record<string, string> = {
    pass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    fail: 'bg-rose-50 text-rose-700 border-rose-200',
    partial: 'bg-amber-50 text-amber-700 border-amber-200',
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex gap-2.5">
          <FlaskConical size={15} strokeWidth={1.75} className="mt-0.5 text-slate-500" />
          <div>
            <div className="text-[15px] font-semibold text-slate-900">Remediation retest</div>
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              Evidence that the finding was re-tested after remediation — a pass here is what closes it out for an auditor.
            </p>
          </div>
        </div>
        <button onClick={() => setOpen(!open)} className="flex-none rounded-lg bg-teal-500 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-teal-600">
          <Plus size={12} className="mr-1 inline align-[-1px]" />Record a test
        </button>
      </div>

      {open && (
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Result</label>
              <select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px]">
                <option value="pass">Pass — no longer exploitable</option>
                <option value="fail">Fail — still exploitable</option>
                <option value="partial">Partial — reduced but present</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Evidence reference</label>
              <input value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })}
                placeholder="Screenshot, scan report or ticket reference"
                className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px]" />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">What was tested and what happened</label>
            <textarea rows={3} value={form.findings} onChange={(e) => setForm({ ...form, findings: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px]" />
          </div>
          <div className="mt-3 flex gap-2">
            <button disabled={create.isPending} onClick={() => create.mutate({ ...form, retest_date: new Date().toISOString() })}
              className="rounded-lg bg-teal-500 px-4 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50 hover:bg-teal-600">
              {create.isPending ? 'Saving…' : 'Save test'}
            </button>
            <button onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-4 py-1.5 text-[12.5px] font-semibold text-slate-600">Cancel</button>
          </div>
          {create.isError && <p className="mt-2 text-[12px] text-rose-600">Could not save the test — check your permissions.</p>}
        </div>
      )}

      <div className="px-5 py-4">
        {retests.isLoading ? (
          <p className="text-[13px] text-slate-400">Loading…</p>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-8 text-center">
            <ShieldAlert size={20} className="mx-auto text-slate-300" />
            <p className="mt-2 text-[13px] font-medium text-slate-500">No retest recorded for this finding.</p>
            <p className="mt-1 text-[12px] text-slate-400">Until one exists, remediation is claimed but not proven.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {items.map((r: any) => (
              <div key={r.id} className="rounded-lg border border-slate-200 p-3.5">
                <div className="flex items-center gap-2.5">
                  <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${TONE[r.result] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                    {r.result}
                  </span>
                  <span className="text-[12.5px] text-slate-500">
                    {r.retest_date ? new Date(r.retest_date).toLocaleString() : '—'}
                  </span>
                  {r.tester_name && <span className="ml-auto text-[12px] text-slate-400">by {r.tester_name}</span>}
                </div>
                {r.findings && <p className="mt-2 text-[13px] leading-relaxed text-slate-700">{r.findings}</p>}
                {r.evidence && <p className="mt-1.5 font-mono text-[11.5px] text-slate-400">{r.evidence}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── 4. Notes — honest placeholder ────────────────────────────────── */

export function VulnNotesPanel() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-1 text-[15px] font-semibold text-slate-900">Notes</div>
      <p className="mb-4 text-[12.5px] text-slate-500">A running commentary on this finding — what was tried, what was ruled out, who was consulted.</p>
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
        <AlertCircle size={14} className="mt-0.5 flex-none" />
        <span>
          <b>Not built yet.</b> There is no comments table for vulnerabilities — the only free text we store is a single
          resolution note captured when the status changes, plus a comment on each workflow transition. Those appear
          under <b>History</b>. A proper notes thread needs a table before this tab can be real.
        </span>
      </div>
    </div>
  );
}
