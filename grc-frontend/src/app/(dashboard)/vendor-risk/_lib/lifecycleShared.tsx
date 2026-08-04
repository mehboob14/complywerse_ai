'use client';

// Shared TPRA lifecycle bits used by the Assessments workspace and the vendor
// register (kept here, outside the [id] route folder, so both can import them).
// The richer per-stage metadata lives in vendors/[id]/_tpra/constants.ts.

export interface BoardRow {
  vendor_id: number;
  vendor_name: string;
  vendor_status: string;
  tier: string | null;
  has_assessment: boolean;
  assessment_id: number | null;
  version_no: number | null;
  current_stage: string | null;
  inherent_score: number | null;
  residual_rating: string | null;
  residual_score: number | null;
  open_findings: number;
  open_critical: number;
  next_review: string | null;
  updated_at: string | null;
}

// Canonical 11-stage order + short labels (mirrors backend TPRA_STAGES).
export const STAGE_SEQUENCE: { key: string; short: string; label: string; gate: boolean }[] = [
  { key: 'intake', short: 'Intake', label: 'Intake & Scoping', gate: false },
  { key: 'tiering', short: 'Tiering', label: 'Inherent Risk Tiering', gate: true },
  { key: 'dd_planning', short: 'Planning', label: 'Due Diligence Planning', gate: false },
  { key: 'questionnaire', short: 'Questionnaire', label: 'Questionnaire & Evidence', gate: false },
  { key: 'scoring', short: 'Scoring', label: 'Risk Analysis & Scoring', gate: false },
  { key: 'findings', short: 'Findings', label: 'Findings & Remediation', gate: false },
  { key: 'contracting', short: 'Contracting', label: 'Contracting & Controls', gate: false },
  { key: 'approval', short: 'Approval', label: 'Approval Decision', gate: true },
  { key: 'onboarding', short: 'Onboarding', label: 'Onboarding & Enablement', gate: false },
  { key: 'monitoring', short: 'Monitoring', label: 'Continuous Monitoring', gate: false },
  { key: 'reassessment', short: 'Reassess', label: 'Reassessment & Offboarding', gate: false },
];

export const STAGE_KEYS = STAGE_SEQUENCE.map((s) => s.key);

export function stageIndex(key?: string | null): number {
  if (!key) return -1;
  return STAGE_KEYS.indexOf(key);
}

export function stageLabel(key?: string | null): string {
  const s = STAGE_SEQUENCE.find((x) => x.key === key);
  return s ? s.label : '—';
}

export function stageNumberLabel(key?: string | null): string {
  const i = stageIndex(key);
  if (i < 0) return '—';
  return `${String(i + 1).padStart(2, '0')} · ${STAGE_SEQUENCE[i].short}`;
}

export function tierBadge(tier?: string | null): string {
  const styles: Record<string, string> = {
    critical: 'bg-rose-50 text-rose-700 border-rose-200',
    high: 'bg-orange-50 text-orange-700 border-orange-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return styles[(tier || '').toLowerCase()] || 'bg-slate-100 text-slate-600 border-slate-200';
}

// Compact 11-dot progress rail. `currentKey` is the in-progress stage; everything
// before it is treated as done. Gate stages render as a small ring.
export function StageProgress({
  currentKey, size = 'md', showLabel = false,
}: { currentKey?: string | null; size?: 'sm' | 'md'; showLabel?: boolean }) {
  const cur = stageIndex(currentKey);
  const dot = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2';
  const gap = size === 'sm' ? 'gap-0.5' : 'gap-1';
  return (
    <div className="flex items-center gap-2" role="img"
      aria-label={currentKey ? `Lifecycle at stage ${cur + 1} of 11: ${stageLabel(currentKey)}` : 'Lifecycle not started'}>
      <div className={`flex items-center ${gap}`}>
        {STAGE_SEQUENCE.map((s, i) => {
          const done = cur >= 0 && i < cur;
          const active = i === cur;
          const color = done
            ? 'bg-primary-500'
            : active
              ? (s.gate ? 'bg-amber-500 ring-2 ring-amber-200' : 'bg-primary-500 ring-2 ring-primary-200')
              : 'bg-slate-200';
          return <span key={s.key} title={`${String(i + 1).padStart(2, '0')} ${s.label}`} className={`${dot} rounded-full ${color}`} />;
        })}
      </div>
      {showLabel && <span className="text-[11px] font-medium text-slate-600 whitespace-nowrap">{stageNumberLabel(currentKey)}</span>}
    </div>
  );
}
