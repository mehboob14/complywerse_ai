'use client';

/**
 * FrameworkJourneyFlow — the "List" view of a framework's compliance journey.
 * A stack of collapsible stage cards: each row shows the stage, a clause/domain
 * reference, its internal/external nature, live status (done / in progress /
 * upcoming, derived from journey progress) and deliverable/artifact counts.
 * Click a row to expand its coverage, deliverables, evidence & owner. The shared
 * identity band comes from <JourneyMeta> (rendered by the wrapper).
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Building2, Check, ChevronDown, FileText, Loader2, Paperclip, Plus, Repeat, UserRound } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import type { FrameworkFlow, FrameworkPhase } from '../_data/frameworkFlows';
import JourneyMeta from './JourneyMeta';
import StageOwnerPicker, { type StageOwner } from './_StageOwnerPicker';

interface Props {
  flow: FrameworkFlow;
  liveControls?: number;
  showMeta?: boolean;
  /** 0–1 completion of the live journey, used to mark stage status. */
  progressRatio?: number;
  /** Journey id + saved per-stage owner map — enable inline owner editing. */
  journeyId?: number;
  stageOwners?: Record<string, StageOwner>;
  /** Framework catalog id + name — enable "Create in Governance" from a stage's
   *  deliverables / evidence (creates a governance draft linked to the framework). */
  frameworkId?: number | null;
  frameworkName?: string;
}

type StageStatus = 'done' | 'in_progress' | 'upcoming';

function statusForIndex(i: number, total: number, ratio: number): StageStatus {
  if (ratio >= 1) return 'done';
  const current = Math.floor(ratio * total);
  if (i < current) return 'done';
  if (i === current) return 'in_progress';
  return 'upcoming';
}

// Condense the coverage prose to its clause/annex references for the row subtitle.
function shortCoverage(coverage: string): string {
  const refs = coverage.match(/(?:Clauses?|Annex|Art(?:icle)?\.?|Principle|Domain|Step|Function)\s+[A-Za-z0-9.,\-–—/&\s]{0,14}?(?=[;.,(]|\s[a-z]|$)/g);
  if (refs && refs.length) {
    return refs.map((r) => r.trim().replace(/[,\s]+$/, '')).filter(Boolean).slice(0, 3).join(' · ');
  }
  return coverage.length > 60 ? `${coverage.slice(0, 58).trimEnd()}…` : coverage;
}

const STATUS_META: Record<StageStatus, { label: string; cls: string }> = {
  done: { label: 'Done', cls: 'border-primary-200 bg-primary-50 text-primary-700' },
  in_progress: { label: 'In progress', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  upcoming: { label: 'Upcoming', cls: 'border-slate-200 bg-slate-100 text-slate-500' },
};

export default function FrameworkJourneyFlow({ flow, liveControls, showMeta = true, progressRatio = 0, journeyId, stageOwners, frameworkId, frameworkName }: Props) {
  const total = flow.phases.length;
  const loopTarget = flow.phases.find((p) => p.n === flow.loopback.to);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const { toast } = useToast();
  const [created, setCreated] = useState<Set<string>>(new Set());

  // Create a deliverable / evidence item as a draft in Governance Documents,
  // linked to this framework as its reference framework (framework_ids).
  const createMut = useMutation({
    mutationFn: (title: string) => governanceApi.createDocument({
      title,
      description: `Drafted from the ${frameworkName || flow.name} compliance journey.`,
      content: `# ${title}\n\n_Drafted from the **${frameworkName || flow.name}** journey. Replace this starter with the actual ${title.toLowerCase()}._\n`,
      doc_type: /procedure/i.test(title) ? 'procedure' : /standard/i.test(title) ? 'standard' : /\bplan\b/i.test(title) ? 'procedure' : 'policy',
      classification: 'internal',
      framework_ids: frameworkId ? [frameworkId] : [],
      applicable_framework_ids: frameworkId ? [frameworkId] : [],
    } as unknown as Record<string, unknown>),
    onSuccess: (_r, title) => {
      setCreated((p) => new Set(p).add(title));
      toast({ type: 'success', title: 'Draft created in Governance', message: `“${title}” added to Governance Documents, linked to ${frameworkName || flow.name}.` });
    },
    onError: () => toast({ type: 'error', title: 'Could not create', message: 'Please try again.' }),
  });
  const onCreate = frameworkId != null ? (title: string) => createMut.mutate(title) : undefined;
  const creating = createMut.isPending ? (createMut.variables ?? null) : null;

  const toggle = (n: number) =>
    setOpen((prev) => {
      const s = new Set(prev);
      if (s.has(n)) s.delete(n); else s.add(n);
      return s;
    });
  const allOpen = open.size === total;

  return (
    <div className="space-y-4">
      {showMeta && <JourneyMeta flow={flow} liveControls={liveControls} />}

      <div className="flex justify-end">
        <button
          onClick={() => setOpen(allOpen ? new Set() : new Set(flow.phases.map((p) => p.n)))}
          className="text-xs font-medium text-slate-500 transition-colors hover:text-primary-700"
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <div className="space-y-2.5">
        {flow.phases.map((phase, i) => (
          <StageCard
            key={phase.n}
            phase={phase}
            total={total}
            status={statusForIndex(i, total, progressRatio)}
            isLoopTarget={phase.n === flow.loopback.to}
            open={open.has(phase.n)}
            onToggle={() => toggle(phase.n)}
            journeyId={journeyId}
            stageOwners={stageOwners}
            onCreate={onCreate}
            created={created}
            creating={creating}
          />
        ))}
      </div>

      {/* Loop-back cycle */}
      <div className="relative flex items-start gap-3 rounded-xl border border-dashed border-primary-300 bg-primary-50/50 p-4">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
          <Repeat className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{flow.loopback.label}</p>
          <p className="mt-0.5 text-xs text-slate-600">
            The programme loops back to{' '}
            <span className="font-semibold text-primary-700">
              Stage {flow.loopback.to}
              {loopTarget ? ` · ${loopTarget.name}` : ''}
            </span>{' '}
            and continues as an ongoing cycle — this is not a one-time project.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Stage card (collapsible) ──────────────────────────────────────── */

function StageCard({
  phase, total, status, isLoopTarget, open, onToggle, journeyId, stageOwners, onCreate, created, creating,
}: {
  phase: FrameworkPhase; total: number; status: StageStatus; isLoopTarget: boolean; open: boolean; onToggle: () => void;
  journeyId?: number; stageOwners?: Record<string, StageOwner>;
  onCreate?: (title: string) => void; created?: Set<string>; creating?: string | null;
}) {
  const ext = phase.ext;
  const done = status === 'done';
  const st = STATUS_META[status];
  const dot = ext ? 'bg-amber-400' : 'bg-primary-500';

  return (
    <div className={`overflow-hidden rounded-xl border border-l-4 bg-white shadow-sm ${ext ? 'border-amber-200 border-l-amber-400' : 'border-slate-200 border-l-primary-500'}`}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-slate-50/70"
        aria-expanded={open}
      >
        {/* Badge — check when done, else stage number */}
        <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${
          done ? 'border-primary-600 bg-primary-500 text-[#0a0a0a]' : 'border-slate-200 bg-slate-50 text-slate-500'
        }`}>
          {done ? <Check className="h-4 w-4" strokeWidth={2.75} /> : phase.n}
        </span>

        {/* Title + clause reference */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-slate-900">{phase.name}</span>
            {isLoopTarget && <Repeat className="h-3.5 w-3.5 flex-shrink-0 text-primary-600" strokeWidth={2.25} />}
          </div>
          <div className="truncate font-mono text-[11px] text-slate-400">{shortCoverage(phase.coverage)}</div>
        </div>

        {/* Meta */}
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className={`hidden rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide sm:inline-flex ${
            ext ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-primary-200 bg-primary-50 text-primary-700'
          }`}>
            {ext ? 'External' : 'Internal'}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
          <span className="hidden items-center gap-1 text-[11px] text-slate-400 md:inline-flex" title={`${phase.deliverables.length} deliverables`}>
            <FileText className="h-3.5 w-3.5" strokeWidth={1.9} />{phase.deliverables.length}
          </span>
          <span className="hidden items-center gap-1 text-[11px] text-slate-400 md:inline-flex" title={`${phase.evidence.length} evidence / artifacts`}>
            <Paperclip className="h-3.5 w-3.5" strokeWidth={1.9} />{phase.evidence.length}
          </span>
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2} />
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3.5 sm:pl-[60px]">
          <p className="mb-3 text-xs leading-relaxed text-slate-500">{phase.coverage}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DetailList icon={<FileText className="h-3.5 w-3.5" strokeWidth={1.9} />} title="Deliverables" items={phase.deliverables} dot={dot} onCreate={onCreate} created={created} creating={creating} />
            <DetailList icon={<Paperclip className="h-3.5 w-3.5" strokeWidth={1.9} />} title="Evidence & artifacts" items={phase.evidence} dot={dot} onCreate={onCreate} created={created} creating={creating} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2.5">
            <UserRound className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" strokeWidth={1.9} />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Owner</span>
            {journeyId ? (
              <StageOwnerPicker
                journeyId={journeyId}
                stageN={phase.n}
                suggested={phase.owner}
                current={stageOwners?.[String(phase.n)] ?? null}
              />
            ) : (
              <span className="text-xs font-medium text-slate-700">{phase.owner}</span>
            )}
            {ext && (
              <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700">
                <Building2 className="h-3 w-3" strokeWidth={2} /> external party
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailList({
  icon, title, items, dot, onCreate, created, creating,
}: {
  icon: React.ReactNode; title: string; items: string[]; dot: string;
  onCreate?: (title: string) => void; created?: Set<string>; creating?: string | null;
}) {
  return (
    <div>
      <h5 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        <span className="text-slate-400">{icon}</span>
        {title}
      </h5>
      <ul className="space-y-1.5">
        {(items || []).map((it, idx) => (
          <li key={idx} className="group flex items-start gap-2 text-xs leading-relaxed text-slate-700">
            <span className={`mt-1.5 h-1 w-1 flex-shrink-0 rounded-full ${dot}`} />
            <span className="flex-1">{it}</span>
            {onCreate && (
              created?.has(it) ? (
                <span className="inline-flex flex-shrink-0 items-center gap-0.5 text-[10px] font-medium text-primary-600" title="Created in Governance Documents">
                  <Check className="h-3 w-3" strokeWidth={2.5} /> In governance
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onCreate(it)}
                  disabled={creating === it}
                  title="Create as a draft in Governance Documents, linked to this framework"
                  className="inline-flex flex-shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-medium text-primary-600 opacity-0 transition-opacity hover:text-primary-700 focus:opacity-100 group-hover:opacity-100 disabled:opacity-100"
                >
                  {creating === it ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" strokeWidth={2.25} />} Create
                </button>
              )
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
