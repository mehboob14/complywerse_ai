'use client';

// "Create issue" on a record's page (Risk, Asset, Vulnerability, controls ...): one click opens the drawer with the record pinned and sensible pre-fills, so an issue can be raised without
// leaving the record. Drawn only for a person who may raise issues (the server refuses anyone else), and not while that is still being read. The props are the old button's.
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/ds';
import { usePermissions } from '@/hooks/usePermissions';
import type { CreatableSource, Presets } from './embedModel';
import { IssueDrawer } from './IssueDrawer';

export const CREATE_ISSUES = 'issue_management:issues:create';

interface Props {
  sourceType: CreatableSource;
  sourceId: number;
  /** Optional pre-filled values; the record's kind supplies the rest. */
  presetFields?: Presets;
  /** Button label; defaults to "Create issue". */
  label?: string;
  /** Visual variant: `compact` is the small button. */
  variant?: 'default' | 'compact';
  className?: string;
  /** The record's name, shown in the drawer ("Linked to this risk: Payments outage"). */
  sourceLabel?: string;
}

export function CreateIssueButton({ sourceType, sourceId, presetFields, label = 'Create issue', variant = 'default', className, sourceLabel }: Props) {
  const [open, setOpen] = useState(false);
  const { hasPermission, isLoading } = usePermissions();
  if (isLoading || !hasPermission(CREATE_ISSUES)) return null;
  return (
    <>
      <Button
        size={variant === 'compact' ? 'sm' : 'md'}
        leftIcon={<Plus aria-hidden />}
        className={className}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        {label}
      </Button>
      <IssueDrawer
        open={open}
        onClose={() => setOpen(false)}
        presetSource={{ source_type: sourceType, source_id: sourceId }}
        presetFields={presetFields}
        sourceLabel={sourceLabel}
      />
    </>
  );
}
