'use client';

// Command-center shell for one lifecycle stage: a compact header + at-a-glance
// capability tiles that open slide-over drawers (Checklist, RACI, Evidence,
// Artifacts, Risk register) + a "Details" popup holding the full stage definition.
// The stage-specific primary surface is passed as children. No long scrolling —
// depth lives in drawers.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Lock, CheckCircle2, AlertTriangle, ArrowRight, RotateCcw, SkipForward, Loader2,
  Info, ListChecks, Users, Paperclip, FileText, ShieldAlert, ArrowDownToLine, Flag, Shield, Circle,
} from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import { tpraApi } from '@/lib/api';
import type { GateResult, StageInstance, TpraAssessment } from './types';
import type { StageMetaDef } from './constants';
import { DOMAIN_LABELS, stageStatusStyle } from './constants';
import StageChecklist from './StageChecklist';
import TeamRosterPanel from './TeamRosterPanel';
import EvidencePanel from './EvidencePanel';
import ArtifactDocumentsPanel from './ArtifactDocumentsPanel';
import RiskRegisterPanel from './RiskRegisterPanel';

const RACI_ROWS: Array<{ k: 'R' | 'A' | 'C' | 'I'; label: string; cls: string }> = [
  { k: 'R', label: 'Responsible', cls: 'bg-blue-100 text-blue-700' },
  { k: 'A', label: 'Accountable', cls: 'bg-red-100 text-red-700' },
  { k: 'C', label: 'Consulted', cls: 'bg-amber-100 text-amber-700' },
  { k: 'I', label: 'Informed', cls: 'bg-gray-100 text-gray-600' },
];

type Drawer = 'details' | 'checklist' | 'raci' | 'evidence' | 'artifacts' | 'risk' | null;

function Tile({ icon, label, badge, tone, onClick }: {
  icon: React.ReactNode; label: string; badge?: string | number | null; tone?: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-primary-300 hover:bg-primary-50/40">
      {icon}
      {label}
      {badge != null && badge !== '' && (
        <span className={`rounded-full px-1.5 text-[10px] font-semibold ${tone || 'bg-slate-100 text-slate-600'}`}>{badge}</span>
      )}
    </button>
  );
}

export default function StageWorkspace({
  vendorId, assessmentId, stageKey, meta, stage, assessment, isCurrent, gate,
  showAdvance, advanceBusy, advanceDisabled, onAdvance,
  showSendBack, onOpenSendBack, showSkip, onOpenSkip,
  children,
}: {
  vendorId: number;
  assessmentId: number;
  stageKey: string;
  meta: StageMetaDef;
  stage?: StageInstance;
  assessment: TpraAssessment;
  isCurrent: boolean;
  gate: GateResult | null;
  showAdvance: boolean; advanceBusy: boolean; advanceDisabled: boolean; onAdvance: () => void;
  showSendBack: boolean; onOpenSendBack: () => void;
  showSkip: boolean; onOpenSkip: () => void;
  children: React.ReactNode;
}) {
  const [drawer, setDrawer] = useState<Drawer>(null);

  const checklist = stage?.checklist || [];
  const checklistTotal = checklist.length || meta.activities.length;
  const checklistDone = checklist.filter((c) => c.done).length;
  // RACI is assigned ONCE at the assessment level (team roster), not per stage.
  const roleCount = Object.keys(assessment.team_roster || {}).length;

  const { data: evidence } = useQuery({
    queryKey: ['tpra-evidence', assessmentId, 'ws-count'],
    queryFn: async () => {
      const d = (await tpraApi.listEvidence(assessmentId)).data as unknown;
      const list = Array.isArray(d) ? d : ((d as { items?: unknown[] })?.items || []);
      return list.length;
    },
  });

  const status = stage?.status || 'not_started';
  const st = stageStatusStyle(status);
  const firstBlocker = isCurrent && gate && !gate.passed ? gate.blockers[0] : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      {/* Header */}
      <div className="border-b border-gray-100 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-gray-400">Stage {String(meta.order).padStart(2, '0')}</span>
              {meta.gate && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  <Lock className="h-3 w-3" /> gate
                </span>
              )}
              <span className={`text-[11px] font-medium ${st.text}`}>{status.replace('_', ' ')}</span>
              {isCurrent && gate && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${gate.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {gate.passed ? <><CheckCircle2 className="h-3 w-3" /> exit met</> : <><AlertTriangle className="h-3 w-3" /> exit not met</>}
                </span>
              )}
            </div>
            <h3 className="mt-0.5 text-base font-semibold text-slate-900">{meta.label}</h3>
            <p className="mt-0.5 max-w-2xl truncate text-xs text-gray-500">{meta.objective}</p>
            {firstBlocker && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                <AlertTriangle className="h-3 w-3" /> {firstBlocker}
              </p>
            )}
          </div>
          {/* Actions */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => setDrawer('details')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
              <Info className="h-3.5 w-3.5" /> Details
            </button>
            {showSkip && (
              <button onClick={onOpenSkip}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                <SkipForward className="h-3.5 w-3.5" /> Skip
              </button>
            )}
            {showSendBack && (
              <button onClick={onOpenSendBack}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">
                <RotateCcw className="h-3.5 w-3.5" /> Send back here
              </button>
            )}
            {showAdvance && (
              <button onClick={onAdvance} disabled={advanceBusy || advanceDisabled}
                title={advanceDisabled ? 'Resolve the exit criteria first' : 'Advance to the next stage'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
                {advanceBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />} Advance
              </button>
            )}
          </div>
        </div>

        {/* Capability tiles */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Tile icon={<ListChecks className="h-3.5 w-3.5 text-primary-600" />} label="Checklist"
            badge={`${checklistDone}/${checklistTotal}`}
            tone={checklistTotal > 0 && checklistDone === checklistTotal ? 'bg-emerald-100 text-emerald-700' : undefined}
            onClick={() => setDrawer('checklist')} />
          <Tile icon={<Users className="h-3.5 w-3.5 text-blue-600" />} label="Assign duties"
            badge={roleCount || undefined} onClick={() => setDrawer('raci')} />
          <Tile icon={<Paperclip className="h-3.5 w-3.5 text-slate-600" />} label="Evidence"
            badge={evidence ?? undefined} onClick={() => setDrawer('evidence')} />
          <Tile icon={<FileText className="h-3.5 w-3.5 text-slate-600" />} label="Artifacts"
            badge={meta.artifacts.length || undefined} onClick={() => setDrawer('artifacts')} />
          <Tile icon={<ShieldAlert className="h-3.5 w-3.5 text-red-500" />} label="Risk register"
            badge={assessment.residual_rating || assessment.inherent_tier || undefined}
            tone="bg-amber-100 text-amber-700" onClick={() => setDrawer('risk')} />
        </div>
      </div>

      {/* Primary surface */}
      <div className="p-4">{children}</div>

      {/* ── Drawers ─────────────────────────────────────────────────────────── */}
      <RightSlidePanel isOpen={drawer === 'details'} onClose={() => setDrawer(null)} title={`${meta.label} — details`} width="w-full max-w-lg">
        <StageDetails meta={meta} isCurrent={isCurrent} gate={gate} />
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
    </div>
  );
}

// Full stage definition — moved off the main screen into the Details popup.
function StageDetails({ meta, isCurrent, gate }: { meta: StageMetaDef; isCurrent: boolean; gate: GateResult | null }) {
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
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400"><Users className="h-3.5 w-3.5" /> Suggested accountability (RACI)</p>
        <div className="space-y-1">
          {RACI_ROWS.map(({ k, label, cls }) => {
            const people = meta.raci[k];
            if (!people || people.length === 0) return null;
            return (
              <div key={k} className="flex items-start gap-2">
                <span className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] font-bold ${cls}`} title={label}>{k}</span>
                <span className="text-xs text-gray-600">{people.join(', ')}</span>
              </div>
            );
          })}
        </div>
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
