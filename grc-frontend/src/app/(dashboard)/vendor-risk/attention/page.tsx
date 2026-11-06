'use client';

// Needs attention — one ranked list of what in the third-party programme needs
// somebody today. Computed live by /vendor-risk/tpra/attention from current data,
// so an item leaves the list the moment the thing behind it is fixed.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock, BellRing, CheckCircle2, History, Loader2, MessageSquare, RotateCcw, UserPlus,
} from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import { fmtDate, titleCase } from '../_lib/tprmShared';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';

type View = 'open' | 'snoozed' | 'closed';
type Action = 'note' | 'assign' | 'snooze' | 'unsnooze' | 'close' | 'reopen';
type FormAction = 'note' | 'assign' | 'snooze' | 'close';

interface Item {
  key: string; condition: string; label: string; record_type: string; record_id: number;
  vendor_id: number; vendor_name: string; vendor_tier: string | null;
  owner_name: string | null; assignee_id: number | null; assignee_name: string | null;
  title: string; badge: string; tone: 'red' | 'amber'; since: string; link: string;
  snoozed_until: string | null; snooze_reason: string | null; state: View;
}
interface Resp {
  items: Item[];
  counts: { open: number; urgent: number; snoozed: number; closed: number };
  conditions: Record<string, string>;
  can_act: boolean;
  assignees: Array<{ id: number; name: string }>;
}
interface Activity {
  id: number; action: Action; text: string | null; actor_name: string | null;
  assignee_name: string | null; created_at: string | null;
}
type ActVars = { item: Item; action: Action; text?: string; until?: string; assignee_id?: number | null };

const TONE = {
  red: { bar: 'bg-red-500', chip: 'border-red-200 bg-red-50 text-red-700' },
  amber: { bar: 'bg-amber-400', chip: 'border-amber-200 bg-amber-50 text-amber-800' },
};
const DID: Record<Action, string> = {
  note: 'added a note', assign: 'assigned it', snooze: 'snoozed it', unsnooze: 'woke it up',
  close: 'closed it', reopen: 'reopened it',
};
const VIEWS: Array<{ v: View; l: string }> = [
  { v: 'open', l: 'Open' }, { v: 'snoozed', l: 'Snoozed' }, { v: 'closed', l: 'Closed' },
];
const EMPTY: Record<View, string> = {
  open: 'Nothing needs attention right now.',
  snoozed: 'Nothing is snoozed.',
  closed: 'Closed items that are still true show here, so they can be reopened. There are none.',
};
const btn = 'inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60';

// yyyy-mm-dd in UTC, the calendar the server judges dates by.
function isoDay(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function errorText(e: unknown): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'That did not save. Try again.';
}

function ActionForm({ item, action, assignees, pending, onSubmit, onCancel }: {
  item: Item; action: FormAction; assignees: Resp['assignees']; pending: boolean;
  onSubmit: (v: Omit<ActVars, 'item' | 'action'>) => void; onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [until, setUntil] = useState(isoDay(7));
  const [assignee, setAssignee] = useState(item.assignee_id ? String(item.assignee_id) : '');
  const prompt = { note: 'Note', assign: 'Note for them (optional)', snooze: 'Why it can wait', close: 'Closing note' }[action];
  const submit = { note: 'Add note', assign: 'Assign', snooze: 'Snooze', close: 'Close item' }[action];
  const field = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800';

  return (
    <form
      className="space-y-2 border-t border-slate-100 bg-slate-50 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          text: text.trim() || undefined,
          until: action === 'snooze' ? until : undefined,
          assignee_id: action === 'assign' ? (assignee ? Number(assignee) : null) : undefined,
        });
      }}
    >
      {action === 'assign' && (
        <label className="block max-w-xs text-xs text-slate-600">
          Assign to
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
            <option value="">Nobody — back to the vendor owner</option>
            {assignees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      )}
      {action === 'snooze' && (
        <label className="block max-w-xs text-xs text-slate-600">
          Bring it back on
          <input type="date" required min={isoDay(1)} max={isoDay(365)} value={until}
            onChange={(e) => setUntil(e.target.value)} className={field} />
        </label>
      )}
      <label className="block text-xs text-slate-600">
        {prompt}
        <textarea required={action !== 'assign'} rows={2} maxLength={4000} value={text}
          onChange={(e) => setText(e.target.value)} className={field} />
      </label>
      {action === 'close' && (
        <p className="text-[11px] text-slate-500">
          The note goes on the vendor&apos;s audit trail. If this becomes urgent again on a new date, it comes back.
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-60">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {submit}
        </button>
        <button type="button" onClick={onCancel} className={btn}>Cancel</button>
      </div>
    </form>
  );
}

function ItemHistory({ item }: { item: Item }) {
  const { data, isLoading } = useQuery({
    queryKey: ['tprm-attention-history', item.key],
    queryFn: async () => (await tpraApi.attentionHistory({
      condition: item.condition, record_type: item.record_type, record_id: item.record_id,
    })).data as { items: Activity[] },
    ...TPRM_QUERY_OPTS,
  });
  const rows = data?.items || [];
  return (
    <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
      {isLoading ? 'Loading…' : rows.length === 0 ? 'No notes or actions yet.' : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li key={a.id}>
              <span className="font-medium text-slate-800">{a.actor_name || 'Someone'}</span>{' '}
              {a.action === 'assign' ? (a.assignee_name ? `assigned it to ${a.assignee_name}` : 'unassigned it') : DID[a.action]}
              <span className="text-slate-400"> · {fmtDate(a.created_at)}</span>
              {a.text && <p className="mt-0.5 whitespace-pre-line text-slate-700">{a.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AttentionPage() {
  const qc = useQueryClient();
  const [scope, setScope] = useState<'portfolio' | 'mine'>('portfolio');
  const [view, setView] = useState<View>('open');
  const [condition, setCondition] = useState('');
  const [form, setForm] = useState<{ key: string; action: FormAction } | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tprm-attention', scope, view],
    queryFn: async () => (await tpraApi.attention({ scope, view })).data as Resp,
    ...TPRM_QUERY_OPTS,
  });

  const act = useMutation({
    mutationFn: async (v: ActVars) => (await tpraApi.attentionAct({
      condition: v.item.condition, record_type: v.item.record_type, record_id: v.item.record_id,
      action: v.action, text: v.text, until: v.until, assignee_id: v.assignee_id,
    })).data,
    onSuccess: (_r, v) => {
      setForm(null);
      setMessage({ ok: true, text: `You ${DID[v.action]}: ${v.item.title}` });
      qc.invalidateQueries({ queryKey: ['tprm-attention'] });
      qc.invalidateQueries({ queryKey: ['tprm-attention-history', v.item.key] });
      qc.invalidateQueries({ queryKey: ['tprm-dashboard'] });
    },
    onError: (e) => setMessage({ ok: false, text: errorText(e) }),
  });

  const items = useMemo(() => data?.items || [], [data]);
  const perCondition = useMemo(() => {
    const c: Record<string, number> = {};
    items.forEach((i) => { c[i.condition] = (c[i.condition] || 0) + 1; });
    return c;
  }, [items]);
  const shown = condition ? items.filter((i) => i.condition === condition) : items;

  if (isLoading) return <PageLoader />;
  if (error || !data) {
    return (
      <div className="p-6 text-sm text-red-600">
        Could not load the queue. <button onClick={() => refetch()} className="underline">Try again</button>
      </div>
    );
  }

  const quick = (item: Item, action: Action) => act.mutate({ item, action });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <BellRing className="h-5 w-5 text-slate-500" /> Needs attention
          </h1>
          <p className="max-w-2xl text-sm text-slate-500">
            What needs somebody today, ranked. Worked out from current data every time, so fixing the thing behind an item removes it.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs font-medium" role="tablist" aria-label="Whose items">
          {(['portfolio', 'mine'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={scope === s} onClick={() => { setScope(s); setCondition(''); }}
              className={`rounded-md px-2.5 py-1 ${scope === s ? 'bg-primary-600 text-[#0a0a0a]' : 'text-slate-600 hover:bg-slate-50'}`}>
              {s === 'portfolio' ? 'Everything' : 'Mine'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200" role="tablist" aria-label="Item state">
        {VIEWS.map(({ v, l }) => (
          <button key={v} role="tab" aria-selected={view === v}
            onClick={() => { setView(v); setCondition(''); setForm(null); }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${view === v ? 'border-primary-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {l} <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{data.counts[v]}</span>
          </button>
        ))}
        {view === 'open' && data.counts.urgent > 0 && (
          <span className="ml-auto text-xs font-medium text-red-600">{data.counts.urgent} urgent</span>
        )}
      </div>

      {Object.keys(perCondition).length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setCondition('')}
            className={`rounded-full border px-2.5 py-1 text-xs ${condition === '' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
            All {items.length}
          </button>
          {Object.entries(perCondition).map(([c, n]) => (
            <button key={c} onClick={() => setCondition(c)}
              className={`rounded-full border px-2.5 py-1 text-xs ${condition === c ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {data.conditions[c] || titleCase(c)} {n}
            </button>
          ))}
        </div>
      )}

      {message && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${message.ok ? 'border-slate-200 bg-white text-slate-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {message.text}
        </p>
      )}

      {shown.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {EMPTY[view]}
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((item) => {
            const tone = TONE[item.tone] || TONE.amber;
            const busy = act.isPending && act.variables?.item.key === item.key;
            return (
              <li key={item.key} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white">
                <span className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} aria-hidden />
                <div className="flex flex-wrap items-start gap-3 py-3 pl-4 pr-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className={`rounded-full border px-2 py-0.5 font-medium ${tone.chip}`}>{item.badge}</span>
                      <span className="font-medium uppercase tracking-wide text-slate-500">{item.label}</span>
                    </div>
                    <Link href={item.link} className="mt-1 block text-sm font-medium text-slate-900 hover:underline">
                      {item.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                      <Link href={`/vendor-risk/vendors/${item.vendor_id}`} className="hover:underline">{item.vendor_name}</Link>
                      {item.vendor_tier && <span>{titleCase(item.vendor_tier)} tier</span>}
                      <span>
                        {item.assignee_name ? `Assigned to ${item.assignee_name}`
                          : item.owner_name ? `Owner: ${item.owner_name}` : 'No owner'}
                      </span>
                      {item.snoozed_until && (
                        <span>Back on {fmtDate(item.snoozed_until)}{item.snooze_reason ? ` — ${item.snooze_reason}` : ''}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {data.can_act && view === 'open' && (
                      <>
                        <button className={btn} onClick={() => setForm({ key: item.key, action: 'note' })}><MessageSquare className="h-3 w-3" /> Note</button>
                        <button className={btn} onClick={() => setForm({ key: item.key, action: 'assign' })}><UserPlus className="h-3 w-3" /> Assign</button>
                        <button className={btn} onClick={() => setForm({ key: item.key, action: 'snooze' })}><AlarmClock className="h-3 w-3" /> Snooze</button>
                        <button className={btn} onClick={() => setForm({ key: item.key, action: 'close' })}><CheckCircle2 className="h-3 w-3" /> Close</button>
                      </>
                    )}
                    {data.can_act && view === 'snoozed' && (
                      <button className={btn} disabled={busy} onClick={() => quick(item, 'unsnooze')}>
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <BellRing className="h-3 w-3" />} Wake up
                      </button>
                    )}
                    {data.can_act && view === 'closed' && (
                      <button className={btn} disabled={busy} onClick={() => quick(item, 'reopen')}>
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Reopen
                      </button>
                    )}
                    <button className={btn} aria-expanded={historyKey === item.key}
                      onClick={() => setHistoryKey(historyKey === item.key ? null : item.key)}>
                      <History className="h-3 w-3" /> History
                    </button>
                  </div>
                </div>
                {form?.key === item.key && (
                  <ActionForm item={item} action={form.action} assignees={data.assignees} pending={busy}
                    onCancel={() => setForm(null)}
                    onSubmit={(v) => act.mutate({ item, action: form.action, ...v })} />
                )}
                {historyKey === item.key && <ItemHistory item={item} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
