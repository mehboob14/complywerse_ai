'use client';

/**
 * The small marks of the hierarchical Requirements view: priority, applicability, an evidence recommendation, an artifact.
 * Fills and text are hex on purpose: the platform CSS repaints slate fills white and slate/emerald text to its own greys and greens
 * (PITFALLS 31, 100), which would make a chip that carries meaning look like every other. Sizes sit on <span>s, never on <button>s.
 */
import { Check, FileText, Package, Plus } from 'lucide-react';
import { applicabilityTip, isTier, priorityTip, type EvidenceChip } from './requirementTree';

export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

// A teal scale for P1 → P4 (the order to plan in, not how bad it is, so nothing here is amber or red).
const TIER: Record<'P1' | 'P2' | 'P3' | 'P4', string> = {
  P1: 'border-[#7cc4b5] bg-[#d3efe8] text-[#0b4f46]',
  P2: 'border-[#a3d6ca] bg-[#e2f4ef] text-[#0f5f55]',
  P3: 'border-[#bfe0d7] bg-[#eef8f5] text-[#256a60]',
  P4: 'border-[#d5dde1] bg-[#f3f6f7] text-[#44535c]',
};
const NEUTRAL = 'border-[#d5dbe1] bg-[#f3f6f8] text-[#3d4852]';
const MUTED = 'border-[#e3e8ec] bg-[#f3f6f8] text-[#5a6670]';

/** P1–P4; nothing for a control without a tier (the annexes have none). `muted`: the smaller one a sub-control shows, inherited from its control. */
export function PriorityChip({ tier, muted = false }: { tier?: string | null; muted?: boolean }) {
  if (!isTier(tier)) return null;
  return (
    <span
      title={priorityTip(tier)}
      data-testid="priority-chip"
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 font-semibold leading-4 ${muted ? `py-0 text-[10px] ${MUTED}` : `py-px text-[11px] ${TIER[tier]}`}`}
    >
      {tier}
    </span>
  );
}

export function ApplicabilityChip({ text, muted = false }: { text?: string | null; muted?: boolean }) {
  const label = (text || '').trim();
  if (!label) return null;
  return (
    <span
      title={applicabilityTip(label)}
      data-testid="applicability-chip"
      className={`inline-flex max-w-full items-center rounded-full border px-2 font-medium leading-4 ${muted ? `py-0 text-[10px] ${MUTED}` : `py-px text-[11px] ${NEUTRAL}`}`}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

/** An evidence recommendation: its name and file type. */
export function EvidenceChipView({ chip }: { chip: EvidenceChip }) {
  return (
    <span
      title={chip.description || chip.name}
      data-testid="evidence-chip"
      className="inline-flex max-w-full items-start gap-1 rounded-md border border-[#d5dbe1] bg-[#fff] px-1.5 py-0.5"
    >
      <FileText className="mt-0.5 h-3 w-3 shrink-0 text-[#586472]" aria-hidden />
      <span className="min-w-0 break-words text-[11px] leading-4 text-[#26323d]">{chip.name}</span>
      {chip.filetype && <span className="shrink-0 text-[10px] font-semibold leading-4 tracking-wide text-[#586472]">{chip.filetype}</span>}
    </span>
  );
}

/** An artifact: its name and type; a click creates it from the template (a plus) or opens the one already made (a tick). */
export function ArtifactChipView({ name, type, created, onClick }: { name: string; type?: string | null; created: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={created ? `Open ${name}` : `Create ${name}`}
      data-testid="artifact-chip"
      data-created={created ? 'true' : 'false'}
      className={`inline-flex max-w-full items-start gap-1 rounded-md border px-1.5 py-0.5 text-left transition-colors ${FOCUS} ${
        created ? 'border-[#9fd0b8] bg-[#effaf4] text-[#14532d] hover:bg-[#e0f4e8]' : 'border-[#9fd5c9] bg-[#f0fdfa] text-[#115e59] hover:bg-[#dcf6f0]'
      }`}
    >
      <Package className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span className="min-w-0 break-words text-[11px] leading-4">{name}</span>
      {type && <span className="shrink-0 text-[10px] font-semibold uppercase leading-4 tracking-wide opacity-80">{type}</span>}
      {created ? <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> : <Plus className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />}
    </button>
  );
}
