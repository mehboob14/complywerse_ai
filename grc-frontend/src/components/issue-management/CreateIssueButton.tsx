'use client';

// Small shared button used on Vuln / Risk / Asset / Control detail pages.
// Single click opens the IssueForm with the linkage pinned + sensible
// pre-fills so users can create an issue without leaving the source page.

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { IssueForm } from '@/app/(dashboard)/issues/_components/IssueForm';

interface Props {
  sourceType:
    | 'vulnerability'
    | 'risk'
    | 'asset'
    | 'control_framework'
    | 'control_parsed'
    | 'control_normalized'
    | 'control_internal'
    // v2 — governance + policy source types accepted by /issues/from-source
    | 'governance_document'
    | 'policy_statement';
  sourceId: number;
  /** Optional pre-filled values — falls back to backend-side derivation. */
  presetFields?: Partial<{
    title: string;
    description: string;
    impact: string;
    urgency: string;
    category: string;
    issue_type: string;
  }>;
  /** Button label; defaults to "Create Issue". */
  label?: string;
  /** Visual variant. */
  variant?: 'default' | 'compact';
  className?: string;
}

export function CreateIssueButton({
  sourceType,
  sourceId,
  presetFields,
  label = 'Create Issue',
  variant = 'default',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);

  const base = 'inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors';
  const styled =
    variant === 'compact'
      ? 'border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-50'
      : 'border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-100';

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`${base} ${styled} ${className}`}
        title="Create a new Issue linked to this item"
      >
        <AlertCircle className={variant === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        {label}
      </button>
      <IssueForm
        open={open}
        onClose={() => setOpen(false)}
        presetSource={{ source_type: sourceType, source_id: sourceId }}
        presetFields={presetFields}
      />
    </>
  );
}
