'use client';

// Automation → Overview. The state of the common control library on one screen.
//
// Six panels, each fed by the system that actually holds the answer: what the
// library contains (SCF), what a check can assert (the plugin engine), which
// frameworks it discharges (the crosswalk), what evidence it asks for (the
// consolidated sets), who owns it and whether it was tested (the control
// workbench), and which way that moved (the assurance snapshots).
//
// Where a system holds nothing yet the panel says so and names the system. "0
// implemented" and "implementation is not tracked here yet" are different
// claims, and only the second one is true today — a dashboard that renders the
// first is worse than no dashboard.

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, BarChart3, CheckCircle2, ClipboardList, FileText,
  Layers, Loader2, Plug, ShieldCheck, Users,
} from 'lucide-react';
import { automationApi } from '@/lib/api';
import { CONTROL_STATUS, FrameworkBadge } from '@/components/soc2/ui';

interface DomainRow {
  domain: string; identifier: string | null; controls: number; material: number;
  with_checks: number; with_evidence: number; frameworks: number;
  tracked: number; implemented: number; objectives: number;
}
interface FrameworkRow {
  key: string; label: string; controls: number; requirements: number;
  requirement_total: number | null;
  counts: Record<string, number>;
  inferred: number; inferred_pct: number;
}
interface Overview {
  release: string;
  library: {
    controls: number; domains: number; material: number; orphans: number;
    objectives: number; pptdf: Record<string, number>;
    cadence: Record<string, number>; by_domain: DomainRow[];
  };
  automation: {
    controls_with_checks: number; checks_bound: number; plugins_enabled: number;
    plugins_run: number; last_run_at: string | null; posture: Record<string, number>;
  };
  collection: {
    connectors: {
      plugin_key: string; title: string | null; provider: string | null;
      state: 'healthy' | 'stale' | 'failing' | 'never_run';
      last_success_at: string | null; days_since_success: number | null;
      last_attempt_at: string | null; error: string | null; controls_affected: number;
    }[];
    counts: Record<string, number>;
    stale_after_days: number;
  };
  frameworks: FrameworkRow[];
  crosswalk: { rows: number; by_match_mode: Record<string, number>; reviewed: number };
  evidence: {
    controls_with_set: number; artifacts: number;
    by_method: Record<string, number>;
    top_owners: { owner: string; artifacts: number }[];
  };
  assurance: Record<string, number | string | Record<string, number>> & {
    tracked: number; assigned: number; implemented: number; tested: number;
    effective: number; partially_effective: number; ineffective: number;
    overdue: number; evidence_pending: number; source: string;
    by_implementation_status: Record<string, number>;
  };
  trend: { date: string; tested: number; effective: number; assigned: number; overdue: number }[];
}

const n = (v: number) => v.toLocaleString();
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Panel({ icon: Icon, title, hint, children, action }: {
  icon: React.ComponentType<{ className?: string }>; title: string; hint?: string;
  children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <Icon className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A proportional bar. Segments carry their own colour so one read shows the mix. */
function Bar({ parts, total }: { parts: { key: string; value: number; cls: string }[]; total: number }) {
  if (!total) return <div className="h-2 rounded bg-slate-100" />;
  return (
    <div className="flex h-2 overflow-hidden rounded bg-slate-100">
      {parts.filter((p) => p.value > 0).map((p) => (
        <div key={p.key} className={p.cls} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.key}: ${n(p.value)}`} />
      ))}
    </div>
  );
}

/** Says which system a number came from, and that an empty one is untracked
 *  rather than zero. */
function NotTracked({ system, cta }: { system: string; cta?: { href: string; label: string } }) {
  return (
    <div className="rounded border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
      <p className="text-sm text-slate-600">Nothing tracked in the {system} yet.</p>
      <p className="mt-1 text-[12px] text-slate-400">
        These counts are zero because no control has been taken up there — not because none is implemented.
      </p>
      {cta && (
        <Link href={cta.href} className="mt-3 inline-block rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
          {cta.label}
        </Link>
      )}
    </div>
  );
}

const POSTURE_CLS: Record<string, string> = {
  passed: 'bg-emerald-500', failed: 'bg-rose-500', partial: 'bg-amber-500',
  error: 'bg-amber-400', expired: 'bg-orange-500', collection_failed: 'bg-purple-500',
  not_run: 'bg-slate-300', manual: 'bg-slate-200',
};
const COLLECTION_CLS: Record<string, string> = {
  healthy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  stale: 'bg-amber-50 text-amber-700 border-amber-200',
  failing: 'bg-purple-50 text-purple-700 border-purple-200',
  never_run: 'bg-slate-50 text-slate-500 border-slate-200',
};

export default function AutomationOverviewPage() {
  const { data, isLoading, error } = useQuery<Overview>({
    queryKey: ['common-overview'],
    queryFn: async () => (await automationApi.getCommonOverview()).data,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading overview…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="m-6 rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Could not load the overview. If no SCF release has been imported for this tenant, import one first.
      </div>
    );
  }

  const { library: lib, automation: au, evidence: ev, assurance: asr, crosswalk: xw } = data;
  const covered = au.controls_with_checks;
  const inferredFw = data.frameworks.filter((f) => f.inferred > 0).sort((a, b) => b.inferred_pct - a.inferred_pct);
  const maxDomain = Math.max(1, ...lib.by_domain.map((d) => d.controls));

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Common controls overview</h1>
          <p className="text-sm text-slate-500">
            One control set, {n(lib.controls)} controls across {lib.domains} domains · SCF {data.release}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link href="/automation/soc2-controls" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Control library
          </Link>
          <Link href="/automation/soc2-controls/coverage" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Coverage
          </Link>
          <Link href="/automation/soc2-controls/review" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Review
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Controls" value={n(lib.controls)} sub={`${n(lib.material)} material · ${n(lib.objectives)} objectives`} />
        <Stat label="Automated" value={n(covered)} sub={`${pct(covered, lib.controls)}% of the library · ${n(au.checks_bound)} checks bound`} />
        <Stat label="Frameworks" value={data.frameworks.length} sub={`${n(xw.rows)} crosswalk rows`} />
        <Stat label="Evidence sets" value={n(ev.controls_with_set)} sub={`${n(ev.artifacts)} artifacts`} />
        <Stat label="Owned" value={n(asr.assigned)} sub={asr.tracked ? `${n(asr.tracked)} tracked` : 'not tracked yet'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon={Activity} title="Automation posture" hint={au.last_run_at ? `last run ${new Date(au.last_run_at).toLocaleDateString()}` : 'never run'}>
          <Bar total={lib.controls} parts={Object.entries(au.posture).map(([k, v]) => ({ key: k, value: v, cls: POSTURE_CLS[k] || 'bg-slate-300' }))} />
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {Object.entries(au.posture).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k} className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${POSTURE_CLS[k] || 'bg-slate-300'}`} />
                <span className="text-slate-600">{CONTROL_STATUS[k]?.label ?? k.replace('_', ' ')}</span>
                <span className="ml-auto font-medium tabular-nums text-slate-800">{n(v)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-slate-100 pt-3 text-[12px] leading-relaxed text-slate-500">
            {n(au.plugins_enabled)} checks enabled, {n(au.plugins_run)} have ever run. A check reaches a control
            through the SOC&nbsp;2 criteria it names, so only the {pct(covered, lib.controls)}% of the library
            that maps to SOC&nbsp;2 can be asserted automatically today.
          </p>
        </Panel>

        <Panel icon={ShieldCheck} title="Crosswalk quality" action={
          <Link href="/automation/soc2-controls/review" className="text-xs font-medium text-blue-700 hover:underline">
            Review queue →
          </Link>
        }>
          <div className="grid grid-cols-3 gap-3 text-center">
            {(['exact', 'parent', 'child'] as const).map((m) => (
              <div key={m} className="rounded border border-slate-200 px-2 py-2">
                <div className="text-lg font-semibold tabular-nums text-slate-900">{n(xw.by_match_mode[m] || 0)}</div>
                <div className="text-[11px] capitalize text-slate-500">{m}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-slate-500">
            {n(xw.reviewed)} of {n(xw.rows)} mappings have a standing reviewer decision.
          </p>
          {inferredFw.length > 0 && (
            <>
              <div className="mt-3 border-t border-slate-100 pt-3 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Inferred rather than matched
              </div>
              <ul className="mt-2 space-y-1.5">
                {inferredFw.map((f) => (
                  <li key={f.key} className="flex items-center gap-2 text-sm">
                    <FrameworkBadge fw={f.key} label={f.label} />
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-100">
                      <div className="h-full bg-violet-400" style={{ width: `${f.inferred_pct}%` }} />
                    </div>
                    <span className="w-24 text-right text-[11px] tabular-nums text-slate-500">
                      {f.inferred}/{f.requirements} · {f.inferred_pct}%
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
                These frameworks reach their coverage partly by rolling a requirement up to a broader code, or
                down to a narrower one. The percentage is sound; the claim behind it is weaker than an exact match.
              </p>
            </>
          )}
        </Panel>
      </div>

      <Panel
        icon={Plug}
        title="Collection health"
        hint={`stale after ${data.collection.stale_after_days} days`}
        action={
          <Link href="/automation/checks" className="text-xs font-medium text-blue-700 hover:underline">
            Checks →
          </Link>
        }
      >
        <div className="flex flex-wrap gap-2">
          {(['healthy', 'stale', 'failing', 'never_run'] as const).map((s) => (
            <span key={s} className={`rounded border px-2 py-0.5 text-xs font-medium ${COLLECTION_CLS[s]}`}>
              {n(data.collection.counts[s] || 0)} {s.replace('_', ' ')}
            </span>
          ))}
        </div>
        {data.collection.connectors.length === 0 ? (
          <p className="mt-3 text-[12px] text-slate-500">No connector has run yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded border border-slate-200">
            {data.collection.connectors.map((c) => (
              <li key={c.plugin_key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${COLLECTION_CLS[c.state]}`}>
                  {c.state.replace('_', ' ')}
                </span>
                <span className="font-medium text-slate-800">{c.provider || c.title || c.plugin_key}</span>
                <span className="text-[11px] text-slate-400">
                  {c.days_since_success != null
                    ? `collected ${c.days_since_success}d ago`
                    : 'never collected successfully'}
                </span>
                {c.error && <span className="text-[11px] text-purple-700">{c.error}</span>}
                <span className="ml-auto text-[11px] tabular-nums text-slate-500">
                  {n(c.controls_affected)} control{c.controls_affected === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 border-t border-slate-100 pt-3 text-[12px] leading-relaxed text-slate-500">
          A connector that cannot authenticate says nothing about the control it feeds, so it is counted here
          rather than as a failure above. Controls it touches read <em>Not collected</em>, never <em>Failing</em>.
        </p>
      </Panel>

      <Panel icon={Layers} title="By domain" hint={`${lib.domains} SCF domains`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-medium">Domain</th>
                <th className="py-2 pr-3 font-medium">Controls</th>
                <th className="py-2 pr-3 font-medium">Material</th>
                <th className="py-2 pr-3 font-medium">Automated</th>
                <th className="py-2 pr-3 font-medium">Evidence set</th>
                <th className="py-2 pr-3 font-medium">Frameworks</th>
                <th className="py-2 font-medium">Owned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lib.by_domain.map((d) => (
                <tr key={d.domain} className="hover:bg-slate-50">
                  <td className="py-1.5 pr-3">
                    <div className="flex items-center gap-2">
                      {d.identifier && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{d.identifier}</span>
                      )}
                      <span className="text-slate-800">{d.domain}</span>
                    </div>
                  </td>
                  <td className="py-1.5 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded bg-slate-100">
                        <div className="h-full bg-slate-400" style={{ width: `${(d.controls / maxDomain) * 100}%` }} />
                      </div>
                      <span className="tabular-nums text-slate-700">{d.controls}</span>
                    </div>
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-slate-600">{d.material || <span className="text-slate-300">—</span>}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-slate-600">
                    {d.with_checks ? `${d.with_checks} · ${pct(d.with_checks, d.controls)}%` : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-slate-600">
                    {d.with_evidence ? `${d.with_evidence} · ${pct(d.with_evidence, d.controls)}%` : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-slate-600">{d.frameworks || <span className="text-slate-300">—</span>}</td>
                  <td className="py-1.5 tabular-nums text-slate-600">{d.tracked ? `${d.implemented}/${d.tracked}` : <span className="text-slate-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon={BarChart3} title="Frameworks" hint="requirements discharged" action={
          <Link href="/automation/soc2-controls/coverage" className="text-xs font-medium text-blue-700 hover:underline">
            Coverage →
          </Link>
        }>
          <ul className="space-y-1.5">
            {data.frameworks.map((f) => {
              const total = f.requirement_total || f.requirements;
              return (
                <li key={f.key} className="flex items-center gap-2 text-sm">
                  <div className="w-32 shrink-0"><FrameworkBadge fw={f.key} label={f.label} /></div>
                  <div className="flex h-2 flex-1 overflow-hidden rounded bg-slate-100">
                    <div className="bg-emerald-500" style={{ width: `${pct(f.requirements, total)}%` }} title={`${f.requirements} mapped`} />
                    <div className="bg-slate-300" style={{ width: `${pct((f.counts.other_party || 0) + (f.counts.out_of_scope || 0), total)}%` }} title="accounted for, not mappable" />
                  </div>
                  <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-slate-500">
                    {n(f.requirements)}/{n(total)}
                  </span>
                  <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
                    {f.controls} ctl
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 border-t border-slate-100 pt-3 text-[12px] leading-relaxed text-slate-500">
            Green is mapped to a control. Grey is accounted for but not mappable — it binds the regulator or
            falls outside the catalogue. The gap is what is genuinely still open.
          </p>
        </Panel>

        <Panel icon={FileText} title="Evidence" hint={`${pct(ev.controls_with_set, lib.controls)}% of controls have a set`}>
          <Bar total={ev.artifacts} parts={[
            { key: 'manual', value: ev.by_method.manual || 0, cls: 'bg-slate-400' },
            { key: 'hybrid', value: ev.by_method.hybrid || 0, cls: 'bg-sky-500' },
            { key: 'automated', value: ev.by_method.automated || 0, cls: 'bg-emerald-500' },
          ]} />
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {Object.entries(ev.by_method).map(([k, v]) => (
              <li key={k} className="text-slate-600">
                <span className="capitalize">{k}</span>{' '}
                <span className="font-medium tabular-nums text-slate-800">{n(v)}</span>
              </li>
            ))}
          </ul>
          {ev.top_owners.length > 0 && (
            <>
              <div className="mt-4 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                <Users className="h-3.5 w-3.5" /> Who the frameworks name as owner
              </div>
              <ul className="mt-2 space-y-1">
                {ev.top_owners.map((o) => (
                  <li key={o.owner} className="flex items-center gap-2 text-sm">
                    <span className="text-slate-700">{o.owner}</span>
                    <span className="ml-auto tabular-nums text-slate-500">{n(o.artifacts)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon={ClipboardList} title="Implementation & assignment" hint={`from the ${asr.source}`}>
          {asr.tracked === 0 ? (
            <NotTracked system={asr.source} cta={{ href: '/control-library', label: 'Open the control library' }} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Tracked" value={n(asr.tracked)} />
                <Stat label="Assigned" value={n(asr.assigned)} sub={`${pct(asr.assigned, asr.tracked)}%`} />
                <Stat label="Implemented" value={n(asr.implemented)} sub={`${pct(asr.implemented, asr.tracked)}%`} />
                <Stat label="Tested" value={n(asr.tested)} sub={`${pct(asr.tested, asr.tracked)}%`} />
              </div>
              <div className="mt-4">
                <Bar total={asr.tested} parts={[
                  { key: 'effective', value: asr.effective, cls: 'bg-emerald-500' },
                  { key: 'partially effective', value: asr.partially_effective, cls: 'bg-amber-500' },
                  { key: 'ineffective', value: asr.ineffective, cls: 'bg-rose-500' },
                ]} />
              </div>
              {(asr.overdue > 0 || asr.evidence_pending > 0) && (
                <ul className="mt-3 flex flex-wrap gap-4 text-sm">
                  {asr.overdue > 0 && (
                    <li className="flex items-center gap-1.5 text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" /> {n(asr.overdue)} overdue for test
                    </li>
                  )}
                  {asr.evidence_pending > 0 && (
                    <li className="flex items-center gap-1.5 text-sky-700">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {n(asr.evidence_pending)} evidence items awaiting review
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
        </Panel>

        <Panel icon={BarChart3} title="Over time" hint={`${data.trend.length} snapshot${data.trend.length === 1 ? '' : 's'}`}>
          {data.trend.length < 2 ? (
            <NotTracked system="assurance snapshot history" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Assigned</th>
                  <th className="py-2 font-medium">Tested</th>
                  <th className="py-2 font-medium">Effective</th>
                  <th className="py-2 font-medium">Overdue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.trend.map((t) => (
                  <tr key={t.date}>
                    <td className="py-1.5 text-slate-700">{t.date}</td>
                    <td className="py-1.5 tabular-nums text-slate-600">{n(t.assigned)}</td>
                    <td className="py-1.5 tabular-nums text-slate-600">{n(t.tested)}</td>
                    <td className="py-1.5 tabular-nums text-slate-600">{n(t.effective)}</td>
                    <td className="py-1.5 tabular-nums text-slate-600">{n(t.overdue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 border-t border-slate-100 pt-3 text-[12px] leading-relaxed text-slate-500">
            One snapshot per day, written by the control library. It tracks the same work items as the panel
            beside it, so both move together — and neither moves until controls are taken up there.
          </p>
        </Panel>
      </div>

      {lib.orphans > 0 && (
        <p className="text-[12px] text-slate-500">
          {n(lib.orphans)} of {n(lib.controls)} controls map to none of the frameworks in this crosswalk. They are
          part of SCF, not part of any obligation you are currently assessed against.
        </p>
      )}
    </div>
  );
}
