'use client';

/**
 * The details of one common control, opened from Links & coverage: what it is, what it asks, who owns it, and
 * the framework requirements it fulfils (so a person can see what a file linked to it is worth), with how this
 * evidence is linked to it. The control's own page has the rest; this is the part needed to judge a link.
 *
 * It opens at once with what the evidence page already knows (the requirement codes), then fills in from the
 * control's detail endpoint; if that cannot be read it says so and keeps what it has.
 */

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import apiClient from '@/lib/api';
import { AnimatedModal } from '@/components/ui';

/** What the panel hands the dialog about the row that was clicked. */
export interface CommonControlRef {
  scfId: string;
  title?: string | null;
  /** How this evidence is linked to the control (the artifact it was linked as, and how fully). */
  linkedAs?: string | null;
  coverage?: string | null;
  /** The requirements the evidence page already has, codes only: shown until the detail arrives. */
  requirements?: Array<{ key: string; label: string; codes: string[] }>;
}

interface ReqItem { code: string; reference?: string | null; title?: string | null; text?: string | null; match_mode?: string | null; resolved?: boolean }
interface ReqGroup { framework: string; label: string; count: number; inferred_count?: number; items: ReqItem[] }
interface ControlDetail {
  control_id: string;
  title: string;
  description?: string | null;
  control_question?: string | null;
  category?: string | null;
  conformity_cadence?: string | null;
  is_material?: boolean;
  owner_name?: string | null;
  ownership_status?: string | null;
  designation?: string | null;
  checks_count?: number;
  overall_status?: string | null;
  requirement_groups?: ReqGroup[];
  requirement_count?: number;
  framework_count?: number;
}

const OWNERSHIP: Record<string, string> = { unowned: 'No owner yet', owned: 'Owned', overdue: 'Overdue', due_soon: 'Due soon' };
// What the checks of a control add up to, said the way the control's own page says it.
const CHECKS: Record<string, string> = {
  connect_one: 'connect a source to run them', not_run: 'not run yet', passed: 'passing', failed: 'failing', partial: 'partly passing', manual: 'manual',
};
const words = (s?: string | null) => (s ? s.replace(/_/g, ' ') : '');
const sentence = (s?: string | null) => { const t = words(s); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="truncate text-sm font-medium text-slate-800" title={value || undefined}>{value || '—'}</dd>
    </div>
  );
}

/** One framework's requirements; each opens to the framework's own wording. */
function Requirements({ group, open }: { group: ReqGroup; open: boolean }) {
  return (
    <details open={open} className="group rounded-lg border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-800 marker:hidden">
        {group.label}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">{group.count}</span>
        {!!group.inferred_count && (
          <span title="Matched through a parent or child requirement rather than on the code itself"
            className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            {group.inferred_count === group.count ? 'all inferred' : `${group.inferred_count} inferred`}
          </span>
        )}
      </summary>
      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {group.items.map((it) => (
          <li key={it.code} className="px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-xs font-semibold text-slate-700">{it.reference || it.code}</span>
              {it.title && <span className="text-sm text-slate-800">{it.title}</span>}
            </div>
            {it.text && <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{it.text}</p>}
            {!it.title && !it.text && it.resolved === false && (
              <p className="mt-0.5 text-xs italic text-slate-400">No wording for this requirement in the library.</p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function CommonControlDialog({ control, onClose }: { control: CommonControlRef; onClose: () => void }) {
  const q = useQuery<ControlDetail>({
    queryKey: ['common-control-detail', control.scfId],
    queryFn: async () => (await apiClient.get(`/automation/common/controls/${encodeURIComponent(control.scfId)}`)).data,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const d = q.data;
  const groups = d?.requirement_groups ?? [];
  // Until the detail arrives (or if it cannot be read), the codes the evidence page already knows.
  const known = control.requirements ?? [];
  const total = d?.requirement_count ?? known.reduce((n, g) => n + g.codes.length, 0);
  const frameworks = d?.framework_count ?? (groups.length || known.length);
  const title = d?.title || control.title || control.scfId;
  const openPage = `/automation/soc2-controls/${encodeURIComponent(control.scfId)}`;

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="lg"
      title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-primary-600" /><span className="font-mono text-sm text-slate-500">{control.scfId}</span> {title}</span>}
      subtitle={[d?.category, d?.conformity_cadence && `${words(d.conformity_cadence)} review`, d?.is_material && 'Material'].filter(Boolean).join(' · ') || undefined}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Link href={openPage} className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline">
            Open the control <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Close</button>
        </div>
      }
    >
      <div className="space-y-5 p-5">
        {(control.linkedAs || control.coverage) && (
          <Section title="This evidence">
            <p className="text-sm text-slate-700">
              {control.linkedAs ? <>Linked as <span className="font-medium">“{control.linkedAs}”</span></> : 'Linked to this control'}
              {control.coverage && <span className="ml-2 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">{sentence(control.coverage)} coverage</span>}
            </p>
          </Section>
        )}

        {q.isLoading && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the control…</p>}
        {q.isError && (
          <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            The control’s details could not be loaded{(q.error as { response?: { status?: number } })?.response?.status === 403 ? ' — your account may not have access to the control library' : ''}. What this evidence already knows is shown below.
          </p>
        )}

        {d && (
          <>
            {(d.description || d.control_question) && (
              <Section title="What the control requires">
                {d.description && <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{d.description}</p>}
                {d.control_question && (
                  <p className="whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">{d.control_question}</p>
                )}
              </Section>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Fact label="Owner" value={d.owner_name || OWNERSHIP[d.ownership_status || ''] || words(d.ownership_status)} />
              <Fact label="Assessment" value={sentence(d.designation) || 'Not assessed'} />
              <Fact label="Automated checks" value={d.checks_count ? `${plural(d.checks_count, 'check')} · ${CHECKS[d.overall_status || ''] ?? words(d.overall_status)}` : 'None'} />
              <Fact label="Requirements" value={total ? `${total} in ${plural(frameworks, 'framework')}` : 'None in scope'} />
            </dl>
          </>
        )}

        <Section title={`Framework requirements it fulfils${total ? ` · ${total}` : ''}`}>
          {groups.length > 0 ? (
            <div className="space-y-2">{groups.map((g, i) => <Requirements key={g.framework} group={g} open={i === 0} />)}</div>
          ) : known.length > 0 ? (
            <ul className="space-y-1.5 text-sm text-slate-700">
              {known.map((g) => (
                <li key={g.key}><span className="font-semibold">{g.label}</span> <span className="text-slate-500">· {g.codes.join(', ')}</span></li>
              ))}
            </ul>
          ) : !q.isLoading ? (
            <p className="text-sm text-slate-500">No requirement of an in-scope framework is mapped to this control.</p>
          ) : null}
        </Section>
      </div>
    </AnimatedModal>
  );
}
