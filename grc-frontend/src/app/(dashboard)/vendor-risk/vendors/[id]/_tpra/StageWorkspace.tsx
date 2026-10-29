'use client';

// The panel of one lifecycle stage. Verity's workspace on our eleven stages: the stage's name, its status and dates, "Complete
// stage" (kept off until the checks clear) and a ⋯ menu (send back, skip), the callouts (completed, skipped), the checks with a
// button to where each is cleared, and who is next. Compliverse's own per-stage content stays inside it: the stage's details and RACI,
// its checklist, the team seats, the evidence pack, the artifact documents and the risk-register drawer, then the stage's surface
// (passed as children). No long scrolling: depth lives in drawers.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowDownToLine, CheckCircle2, Circle, FileText, Flag, Info, ListChecks, Loader2, Lock, MoreHorizontal, Paperclip,
  Shield, ShieldAlert, Users,
} from 'lucide-react';
import { BTN_ICON, BTN_PRIMARY, StatusPill, TONE, fmt, tones } from '@/app/(dashboard)/vendor-risk/_ui';
import { RightSlidePanel } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { tpraApi, adminApi } from '@/lib/api';
import { skippedBy, type Fix } from '../../../_lib/lifecycleLogic';
import type { GateView } from '../../../_lib/lifecycleApi';
import type { StageInstance, TpraAssessment } from './types';
import type { StageMetaDef, StageRaci } from './constants';
import { DOMAIN_LABELS, rosterKeyForRaciLabel } from './constants';
import CheckList from './CheckList';
import StageChecklist from './StageChecklist';
import TeamRosterPanel from './TeamRosterPanel';
import EvidencePanel from './EvidencePanel';
import ArtifactDocumentsPanel from './ArtifactDocumentsPanel';
import RiskRegisterPanel from './RiskRegisterPanel';

const RACI_ROWS: Array<{ k: 'R' | 'A' | 'C' | 'I'; label: string; cls: string }> = [
  { k: 'R', label: 'Responsible', cls: 'bg-teal-100 text-teal-700' },
  { k: 'A', label: 'Accountable', cls: 'bg-slate-800 text-white' },
  { k: 'C', label: 'Consulted', cls: 'bg-amber-100 text-amber-700' },
  { k: 'I', label: 'Informed', cls: 'bg-slate-100 text-slate-600' },
];

// Resolve one playbook RACI label (an org function) to the assigned person's name
// via the assessment team roster. Returns null when the label maps to no roster
// function (e.g. the external "Vendor") or the seat is unassigned.
function resolveRaciName(
  label: string,
  roster: Record<string, number> | null | undefined,
  nameFor: (id: number) => string,
): { label: string; name: string | null } {
  const key = rosterKeyForRaciLabel(label);
  const uid = key && roster ? roster[key] : undefined;
  return { label, name: uid ? nameFor(uid) : null };
}

type Drawer = 'details' | 'checklist' | 'raci' | 'evidence' | 'artifacts' | 'risk' | null;

const STATUS_WORD: Record<string, string> = {
  not_started: 'Not started', in_progress: 'In progress', complete: 'Complete', skipped: 'Skipped', blocked: 'Blocked',
};

function Tile({ icon, label, badge, tone, onClick }: {
  icon: ReactNode; label: string; badge?: string | number | null; tone?: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#d5dbe1] bg-[#fff] px-2.5 py-1.5 text-[13px] font-medium text-[#26323d] hover:border-[#99d5cf] hover:bg-[#fbfefd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
      {icon}
      {label}
      {badge != null && badge !== '' && (
        <span className={`rounded-full px-1.5 text-[11px] font-semibold ${tone || 'bg-[#eef1f4] text-[#586472]'}`}>{badge}</span>
      )}
    </button>
  );
}

/** The ⋯ menu: defined here, outside the panel, so it does not remount (and close) every time the panel renders. */
function Overflow({ items }: { items: Array<{ key: string; label: string; onClick: () => void }> }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div ref={box} className="relative">
      <button type="button" className={BTN_ICON} aria-expanded={open} aria-label="More actions" title="More actions" onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal aria-hidden className="h-4 w-4" />
      </button>
      {open && (
        <ul className="absolute right-0 z-20 mt-1 min-w-[180px] rounded-lg border border-[#d5dbe1] bg-[#fff] py-1 shadow-card">
          {items.map((i) => (
            <li key={i.key}>
              <button type="button" className="block w-full px-3 py-2 text-left text-[13px] text-[#26323d] hover:bg-[#f3f6f8] focus-visible:bg-[#f3f6f8] focus-visible:outline-none"
                onClick={() => { setOpen(false); i.onClick(); }}>
                {i.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function StageWorkspace({
  vendorId, assessmentId, stageKey, meta, stage, assessment, isCurrent, gate,
  canAdvance, advanceBusy, onAdvance, menu, canFix, onFix, next, children,
}: {
  vendorId: number;
  assessmentId: number;
  stageKey: string;
  meta: StageMetaDef;
  stage?: StageInstance & { skipped_by?: number | null };
  assessment: TpraAssessment;
  isCurrent: boolean;
  gate: GateView | null;
  /** the person may move work along (and this is the current stage) */
  canAdvance: boolean;
  advanceBusy: boolean;
  onAdvance: () => void;
  /** send back, skip, new review: what the person may do from this stage */
  menu: Array<{ key: string; label: string; onClick: () => void }>;
  canFix: boolean;
  onFix: (fix: Fix) => void;
  /** the "NEXT" bar, drawn under the checks */
  next?: ReactNode;
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState<Drawer>(null);

  const checklist = stage?.checklist || [];
  const checklistTotal = checklist.length || meta.activities.length;
  const checklistDone = checklist.filter((c) => c.done).length;
  // RACI is assigned ONCE at the assessment level (team roster), not per stage.
  const roleCount = Object.keys(assessment.team_roster || {}).length;

  // Names for the roster user_ids so the stage's abstract RACI labels resolve to
  // real people. Shares the roster/intake user cache — no extra request in practice.
  const { data: users } = useQuery({
    queryKey: ['admin-users-for-tpra-intake'],
    queryFn: async () => {
      try {
        const r = await adminApi.getUsers();
        return ((r.data || []) as Array<{ id: number; email?: string; full_name?: string; name?: string; first_name?: string; last_name?: string }>).map((u) => ({
          id: u.id,
          name: u.full_name || u.name || [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || `User ${u.id}`,
        }));
      } catch { return []; }
    },
  });
  const nameFor = (id: number) => (users || []).find((u) => u.id === id)?.name || `User ${id}`;
  const roster = assessment.team_roster;
  // The single Accountable person for this stage (first "A" label that resolves).
  const accountable = (meta.raci.A || [])
    .map((l) => resolveRaciName(l, roster, nameFor))
    .find((r) => r.name)?.name || null;

  const { data: evidence } = useQuery({
    queryKey: ['tpra-evidence', assessmentId, 'ws-count'],
    queryFn: async () => {
      const d = (await tpraApi.listEvidence(assessmentId)).data as unknown;
      const list = Array.isArray(d) ? d : ((d as { items?: unknown[] })?.items || []);
      return list.length;
    },
  });

  const status = stage?.status || 'not_started';
  const blocked = isCurrent && !!gate && !gate.passed;
  const skipped = status === 'skipped' && stage ? skippedBy(stage) : null;
  const entered = stage?.started_at && status !== 'not_started'
    ? `Entered ${fmt.date(stage.started_at)}${stage.completed_at ? ` · left ${fmt.date(stage.completed_at)}` : ''}` : 'Not entered';

  return (
    <section aria-label={meta.label} className="min-w-0">
      <div className="space-y-3 border-b border-[#eef1f4] p-4">
        {/* Title, status, dates; the actions on the right */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold tabular-nums text-[#64707e]">Stage {String(meta.order).padStart(2, '0')}</span>
              {meta.gate && (
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: TONE.warning.tint, color: TONE.warning.text, borderColor: TONE.warning.border }}>
                  <Lock aria-hidden className="h-3 w-3" /> Gate
                </span>
              )}
              <StatusPill tone={blocked ? 'warning' : tones.stage(status)}>{blocked ? 'Blocked' : (STATUS_WORD[status] ?? status)}</StatusPill>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h3 className="text-[17px] font-semibold leading-6 text-[#1f2933]">{meta.label}</h3>
              <InfoTip text={meta.objective} label={`About ${meta.label}`} />
              <span className="inline-flex items-center gap-1 rounded-full border border-[#e1e6eb] bg-[#f6f8fa] px-2 py-0.5 text-[11px] font-medium text-[#586472]"
                title="Accountable owner for this stage (from the assessment team roster)">
                <Users aria-hidden className="h-3 w-3" strokeWidth={1.75} />
                Accountable:&nbsp;
                {accountable ? <span className="font-semibold text-[#26323d]">{accountable}</span> : <span className="italic text-[#64707e]">unassigned</span>}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] leading-4 text-[#64707e]">{entered}</p>
          </div>
          {(isCurrent || menu.length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {isCurrent && canAdvance && (
                <span title={blocked ? 'Clear the open checks first' : undefined}>
                  <button type="button" className={BTN_PRIMARY} onClick={onAdvance} disabled={advanceBusy || blocked}>
                    {advanceBusy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <CheckCircle2 aria-hidden className="h-4 w-4" />} Complete stage
                  </button>
                </span>
              )}
              <Overflow items={menu} />
            </div>
          )}
        </div>

        {/* Callouts */}
        {status === 'complete' && (
          <p className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] leading-5" style={{ background: TONE.success.tint, color: TONE.success.text }}>
            <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0" /> Completed {fmt.date(stage?.completed_at)}
          </p>
        )}
        {skipped && (
          <p className="rounded-lg px-3 py-2 text-[13px] leading-5" style={{ background: TONE.neutral.tint, color: TONE.neutral.text }}>
            {skipped.byPolicy ? `Skipped by policy for this tier: ${skipped.reason}` : `Skipped: ${skipped.reason}`}
          </p>
        )}

        {/* Checks, and who is next */}
        {status !== 'complete' && status !== 'skipped' && (
          <CheckList checks={gate?.checks} isCurrent={isCurrent} canFix={isCurrent && canFix} onFix={onFix} />
        )}
        {isCurrent && !canAdvance && status !== 'complete' && (
          <p className="text-[12px] leading-4 text-[#64707e]">Moving this along needs the right to advance stages.</p>
        )}
        {next}

        {/* Capability tiles */}
        <div className="flex flex-wrap gap-2">
          <Tile icon={<Info aria-hidden className="h-3.5 w-3.5 text-[#586472]" />} label="Details" onClick={() => setDrawer('details')} />
          {stageKey !== 'onboarding' && (        // onboarding draws its checklist in the panel: it is the stage's check
            <Tile icon={<ListChecks aria-hidden className="h-3.5 w-3.5 text-[#0f766e]" />} label="Checklist"
              badge={`${checklistDone}/${checklistTotal}`}
              tone={checklistTotal > 0 && checklistDone === checklistTotal ? 'bg-[#e7f5ef] text-[#08794f]' : undefined}
              onClick={() => setDrawer('checklist')} />
          )}
          <Tile icon={<Users aria-hidden className="h-3.5 w-3.5 text-[#0f766e]" strokeWidth={1.75} />} label="Assign duties"
            badge={roleCount || undefined} onClick={() => setDrawer('raci')} />
          <Tile icon={<Paperclip aria-hidden className="h-3.5 w-3.5 text-[#586472]" />} label="Evidence"
            badge={evidence ?? undefined} onClick={() => setDrawer('evidence')} />
          <Tile icon={<FileText aria-hidden className="h-3.5 w-3.5 text-[#586472]" />} label="Artifacts"
            badge={meta.artifacts.length || undefined} onClick={() => setDrawer('artifacts')} />
          <Tile icon={<ShieldAlert aria-hidden className="h-3.5 w-3.5 text-[#c01741]" />} label="Risk register"
            badge={assessment.residual_rating || assessment.inherent_tier || undefined}
            tone="bg-[#fbf1e4] text-[#9a5007]" onClick={() => setDrawer('risk')} />
        </div>
      </div>

      {/* The stage's own surface */}
      <div className="p-4">{children}</div>

      {/* ── Drawers ─────────────────────────────────────────────────────────── */}
      <RightSlidePanel isOpen={drawer === 'details'} onClose={() => setDrawer(null)} title={`${meta.label} — details`} width="w-full max-w-lg">
        <StageDetails meta={meta} isCurrent={isCurrent} gate={gate} roster={roster} nameFor={nameFor} />
      </RightSlidePanel>

      <RightSlidePanel isOpen={drawer === 'checklist'} onClose={() => setDrawer(null)} title={`${meta.label} — checklist`} width="w-full max-w-lg">
        <StageChecklist key={`${stageKey}-${checklist.length}`} assessmentId={assessmentId} stageKey={stageKey}
          activities={meta.activities} initial={stage?.checklist} />
      </RightSlidePanel>

      <RightSlidePanel isOpen={drawer === 'raci'} onClose={() => setDrawer(null)} title="Assign duties — assessment team" width="w-full max-w-lg">
        <TeamRosterPanel assessmentId={assessmentId} initial={assessment.team_roster} />
      </RightSlidePanel>

      <RightSlidePanel isOpen={drawer === 'evidence'} onClose={() => setDrawer(null)} title={`${meta.label} — evidence`} width="w-full max-w-lg">
        <EvidencePanel assessmentId={assessmentId} title="Evidence pack" />
      </RightSlidePanel>

      <RightSlidePanel isOpen={drawer === 'artifacts'} onClose={() => setDrawer(null)} title={`${meta.label} — artifacts`} width="w-full max-w-2xl">
        <ArtifactDocumentsPanel vendorId={vendorId} assessmentId={assessmentId} stageLabel={meta.label} expectedArtifacts={meta.artifacts} />
      </RightSlidePanel>

      <RightSlidePanel isOpen={drawer === 'risk'} onClose={() => setDrawer(null)} title="Risk register" width="w-full max-w-lg">
        <RiskRegisterPanel assessmentId={assessmentId} assessment={assessment} />
      </RightSlidePanel>
    </section>
  );
}

// Full stage definition — moved off the main screen into the Details popup.
function StageDetails({
  meta, isCurrent, gate, roster, nameFor,
}: {
  meta: StageMetaDef; isCurrent: boolean; gate: GateView | null;
  roster: Record<string, number> | null | undefined;
  nameFor: (id: number) => string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-600">{meta.objective}</p>

      {meta.inputs.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400"><ArrowDownToLine className="h-3.5 w-3.5" /> Inputs</p>
          <ul className="space-y-0.5 text-xs text-gray-600">
            {meta.inputs.map((a, i) => <li key={i} className="flex items-start gap-1.5"><Circle className="mt-1 h-2 w-2 flex-shrink-0 fill-gray-300 text-gray-300" />{a}</li>)}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400"><ListChecks className="h-3.5 w-3.5" /> Key activities</p>
        <ul className="space-y-0.5 text-xs text-gray-600">
          {meta.activities.map((a, i) => <li key={i} className="flex items-start gap-1.5"><Circle className="mt-1 h-2 w-2 flex-shrink-0 fill-gray-300 text-gray-300" />{a}</li>)}
        </ul>
      </div>

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400"><Users className="h-3.5 w-3.5" strokeWidth={1.75} /> Accountability (RACI) — assigned team</p>
        <div className="space-y-1.5">
          {RACI_ROWS.map(({ k, label, cls }) => {
            const labels = (meta.raci as StageRaci)[k];
            if (!labels || labels.length === 0) return null;
            const resolved = labels.map((l) => resolveRaciName(l, roster, nameFor));
            return (
              <div key={k} className="flex items-start gap-2">
                <span className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] font-bold ${cls}`} title={label}>{k}</span>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                  {resolved.map((r, i) => (
                    <span key={i} className="inline-flex items-baseline gap-1">
                      {r.name
                        ? <span className="font-medium text-slate-800">{r.name}</span>
                        : <span className="italic text-slate-400">unassigned</span>}
                      <span className="text-[10px] text-slate-400">({r.label})</span>
                      {i < resolved.length - 1 && <span className="text-slate-300">·</span>}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10px] text-slate-400">
          Resolved from the assessment team roster. Assign people in <span className="font-medium">Assign duties</span> to fill any unassigned seats.
        </p>
      </div>

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400"><FileText className="h-3.5 w-3.5" /> Artifacts produced</p>
        <div className="flex flex-wrap gap-1.5">
          {meta.artifacts.map((a) => <span key={a} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">{a}</span>)}
        </div>
      </div>

      {meta.domains.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400"><Shield className="h-3.5 w-3.5" /> Risk domains</p>
          <div className="flex flex-wrap gap-1.5">
            {meta.domains.map((d) => <span key={d} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{DOMAIN_LABELS[d] || d}</span>)}
          </div>
        </div>
      )}

      <div className={`rounded-lg border p-3 ${meta.gate ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/50'}`}>
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          <Flag className={`h-3.5 w-3.5 ${meta.gate ? 'text-amber-600' : 'text-emerald-600'}`} />
          {meta.gate ? 'Decision gate — exit criteria' : 'Exit criteria'}
          {isCurrent && gate && (
            <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${gate.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {gate.passed ? <><CheckCircle2 className="h-3 w-3" /> met</> : <><AlertTriangle className="h-3 w-3" /> not yet met</>}
            </span>
          )}
        </p>
        <p className="mt-1.5 text-xs text-gray-600">{meta.exitCriteria}</p>
        {isCurrent && gate && !gate.passed && gate.blockers.length > 0 && (
          <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-amber-700">
            {gate.blockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
