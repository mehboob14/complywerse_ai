'use client';

// The change at a glance: four numbers you can click through, the circular in a
// few lines, what needs someone's attention next, and the facts, editable where
// a person would want to correct them.

import { useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronRight, ClipboardList, ListChecks, Lock, ShieldCheck, Sparkles, Target, UserX,
  type LucideIcon,
} from 'lucide-react';
import { MultiSelectDropdown } from '@/components/ui';
import {
  assigneesOf, dueIn, fmtDate, regulatorName, useLinks, useObligations, useTasks, useUsers, type RegulatoryChange,
  type TabFilter,
} from '../_ui';

type Go = (tab: string, filter?: TabFilter) => void;

function Tile({ icon: Icon, label, value, sub, bar, onClick }: {
  icon: LucideIcon; label: string; value: React.ReactNode; sub: React.ReactNode; bar?: number; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/30">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
      {bar !== undefined && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>
      )}
      <p className="mt-1 truncate text-[11px] text-slate-500">{sub}</p>
    </button>
  );
}

const dateInput = 'w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm text-slate-900 hover:border-slate-300 focus:border-primary-500 focus:outline-none';

export default function OverviewPanel({ change, onGo, onUpdate, onClose }: {
  change: RegulatoryChange; onGo: Go; onUpdate: (data: Record<string, unknown>) => void; onClose: () => void;
}) {
  const { data: obligations = [] } = useObligations(change.id);
  const { data: links = [] } = useLinks(change.id);
  const { data: tasks = [] } = useTasks(change.id);
  const { people } = useUsers();
  const [more, setMore] = useState(false);

  const total = obligations.length;
  const compliant = obligations.filter((o) => o.compliance_status === 'compliant').length;
  const notAssessed = obligations.filter((o) => o.compliance_status === 'not_assessed').length;
  const toCheck = obligations.filter((o) => o.source === 'ai' && !o.verified).length;
  const metIds = new Set(links.filter((l) => l.status === 'confirmed').map((l) => l.obligation_id));
  const suggestedIds = new Set(links.filter((l) => l.status === 'proposed').map((l) => l.obligation_id));
  const met = obligations.filter((o) => metIds.has(o.id)).length;
  const toReview = links.filter((l) => l.status === 'proposed').length;
  const noControl = obligations.filter((o) => !metIds.has(o.id) && !suggestedIds.has(o.id)).length;
  const done = tasks.filter((t) => t.status === 'completed').length;
  const late = tasks.filter((t) => t.status !== 'completed' && dueIn(t.due_date)?.late).length;
  const unassigned = tasks.filter((t) => assigneesOf(t).length === 0 && t.status !== 'completed').length;
  const gaps = change.gap_count || 0;
  const assessed = change.assessment_count || 0;

  const attention: Array<{ n: number; text: string; icon: LucideIcon; tone: string; go: () => void }> = [
    { n: late, text: `task${late === 1 ? ' is' : 's are'} past due`, icon: AlertTriangle, tone: 'text-rose-600', go: () => onGo('tasks', { late: true }) },
    { n: toCheck, text: `obligation${toCheck === 1 ? '' : 's'} to check against the circular's wording`, icon: AlertTriangle, tone: 'text-amber-600', go: () => onGo('obligations', { toCheck: true }) },
    { n: toReview, text: `control suggestion${toReview === 1 ? '' : 's'} to confirm or reject`, icon: Sparkles, tone: 'text-amber-600', go: () => onGo('obligations', { control: 'review' }) },
    { n: notAssessed, text: `obligation${notAssessed === 1 ? '' : 's'} not yet assessed for compliance`, icon: ListChecks, tone: 'text-slate-500', go: () => onGo('obligations', { status: 'not_assessed' }) },
    { n: noControl, text: `obligation${noControl === 1 ? '' : 's'} without a control`, icon: ShieldCheck, tone: 'text-slate-500', go: () => onGo('obligations', { control: 'none' }) },
    { n: gaps, text: `impact assessment${gaps === 1 ? '' : 's'} with a gap`, icon: Target, tone: 'text-rose-600', go: () => onGo('assessments', { gapsOnly: true }) },
    { n: unassigned, text: `open task${unassigned === 1 ? '' : 's'} with nobody assigned`, icon: UserX, tone: 'text-slate-500', go: () => onGo('tasks', { who: 'none' }) },
  ].filter((a) => a.n > 0);

  const effective = dueIn(change.effective_date);
  const analysis = change.analysis?.status === 'done' ? change.analysis : null;
  const description = change.description || '';

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile icon={ListChecks} label="Compliance" value={<>{compliant}<span className="text-sm font-normal text-slate-400">/{total}</span></>}
            bar={total ? compliant / total : 0} sub={total ? `${notAssessed} not assessed` : 'No obligations yet'}
            onClick={() => onGo('obligations')} />
          <Tile icon={ShieldCheck} label="Controls" value={<>{met}<span className="text-sm font-normal text-slate-400">/{total}</span></>}
            bar={total ? met / total : 0} sub={toReview ? `${toReview} suggestion${toReview === 1 ? '' : 's'} to review` : 'obligations met by a control'}
            onClick={() => onGo('obligations', toReview ? { control: 'review' } : {})} />
          <Tile icon={Target} label="Impact" value={assessed} sub={assessed ? `${gaps} with a gap` : 'No assessments yet'}
            onClick={() => onGo('assessments')} />
          <Tile icon={ClipboardList} label="Tasks" value={<>{done}<span className="text-sm font-normal text-slate-400">/{tasks.length}</span></>}
            bar={tasks.length ? done / tasks.length : 0}
            sub={late ? <span className="text-rose-700">{late} past due</span> : tasks.length ? `${tasks.length - done} open` : 'No tasks yet'}
            onClick={() => onGo('tasks')} />
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">What the circular says</h2>
          <p className={`mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700 ${more ? '' : 'line-clamp-4'}`}>
            {description || 'No summary yet. It is written when the AI reads the circular.'}
          </p>
          {description.length > 320 && (
            <button type="button" onClick={() => setMore((v) => !v)} className="mt-1 text-xs font-medium text-primary-700 hover:underline">
              {more ? 'Show less' : 'Read more'}
            </button>
          )}
          {change.impact_summary && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{change.impact_summary}</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white">
          <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">Needs attention</h2>
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Nothing is waiting on anyone right now.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {attention.map((a) => (
                <li key={a.text}>
                  <button type="button" onClick={a.go} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                    <a.icon className={`h-4 w-4 shrink-0 ${a.tone}`} />
                    <span className="flex-1 text-slate-700"><b className="font-semibold text-slate-900">{a.n}</b> {a.text}</span>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Details</h2>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
            <div className="col-span-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Regulator</dt>
              <dd className="mt-0.5 text-slate-900">{regulatorName(change.source)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Reference</dt>
              <dd className="mt-0.5 truncate font-mono text-[13px] text-slate-900">{change.reference_number || '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Published</dt>
              <dd><input type="date" aria-label="Published" className={dateInput} value={(change.publication_date || '').slice(0, 10)}
                onChange={(e) => onUpdate({ published_date: e.target.value || null })} /></dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Effective</dt>
              <dd><input type="date" aria-label="Effective" className={dateInput} value={(change.effective_date || '').slice(0, 10)}
                onChange={(e) => onUpdate({ effective_date: e.target.value || null })} />
                {effective && change.status !== 'completed' && (
                  <p className={`px-1 text-[11px] ${effective.late ? 'text-rose-700' : 'text-slate-500'}`}>
                    {effective.late ? `in force for ${effective.text.replace(' late', '')}` : `takes effect ${effective.text}`}
                  </p>
                )}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="mb-0.5 text-[11px] uppercase tracking-wide text-slate-500">Owner</dt>
              <dd>
                <MultiSelectDropdown title="Nobody yet" triggerVariant="input" size="sm" multiSelect={false} autoApply forceSearch
                  items={people} selectedValues={change.assigned_to ? [String(change.assigned_to)] : []}
                  onApply={(v) => onUpdate({ assigned_to: v[0] ? Number(v[0]) : null })} />
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Recorded</dt>
              <dd className="mt-0.5 text-slate-900">{fmtDate(change.created_at)}{change.creator_name && <span className="text-slate-500"> by {change.creator_name}</span>}</dd>
            </div>
            {analysis && (
              <div className="col-span-2">
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">AI analysis</dt>
                <dd className="mt-0.5 flex items-start gap-1.5 text-slate-700">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-600" />
                  <span>
                    Read in full{analysis.seconds ? ` in ${analysis.seconds < 90 ? `${analysis.seconds} s` : `${Math.round(analysis.seconds / 60)} min`}` : ''}:
                    {' '}{analysis.counts?.obligations ?? 0} obligations, {analysis.counts?.verified ?? 0} word for word
                  </span>
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Lock className="h-4 w-4 text-slate-400" /> Closure</h2>
          {change.status === 'completed' ? (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Closed{change.closed_at ? ` ${fmtDate(change.closed_at)}` : ''}{change.closed_by_name ? ` by ${change.closed_by_name}` : ''}
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-slate-500">{done} of {tasks.length} tasks completed</p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} />
              </div>
              <button type="button" onClick={onClose}
                className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Close this change…
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
