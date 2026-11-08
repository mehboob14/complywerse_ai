'use client';

// The two questions the Requirements tab asks before it changes several things at once, or before it sends something a reviewer has to answer:
//   ScopeAskDialog      "why is it not applicable?" (a reason is required: it is the audit trail), for one requirement or the ticked ones. The dialog says what will happen: the server keeps
//                       the request for a reviewer and the requirement stays as it is until then. Putting a requirement back in scope asks for an optional reason.
//   BulkOwnersDialog    who should own the ticked requirements: added to their owners (nobody is taken off) or replacing them (nobody chosen withdraws every owner).
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
import { Button, FormField, MultiSelect, Notice, SegmentedControl, Textarea, type ListOption } from '@/components/ui/ds';
import { formatCount, truncate } from '@/lib/format';
import type { OwnerMode, ReqRow } from './reqModel';

export interface ScopeAskDialogProps {
  /** the requirements asked about; empty keeps the dialog shut */
  targets: readonly ReqRow[];
  /** true: put (back) in scope; false: out of scope */
  applicable: boolean;
  pending: boolean;
  /** requirements ticked that the request does not apply to (already in / out of scope) and the words for it */
  skipped?: { count: number; why: string };
  onClose: () => void;
  onSubmit: (justification: string) => void;
}

export function ScopeAskDialog({ targets, applicable, pending, skipped, onClose, onSubmit }: ScopeAskDialogProps) {
  const [reason, setReason] = useState('');
  const open = targets.length > 0;
  useEffect(() => { if (open) setReason(''); }, [open]);
  const many = targets.length > 1;
  const critical = targets.filter((t) => t.critical);
  const needed = !applicable;
  const ready = !needed || reason.trim().length > 0;
  const noun = many ? `${formatCount(targets.length)} requirements` : 'this requirement';
  const first = targets[0];
  return (
    <AnimatedModal
      isOpen={open}
      onClose={onClose}
      dirty={reason.trim().length > 0}
      title={applicable ? `Ask to put ${noun} back in scope` : `Ask to put ${noun} out of scope`}
      subtitle={first && !many ? `${first.code} ${truncate(first.name, 90).text}`.trim() : undefined}
      size="lg"
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} disabled={!ready} onClick={() => onSubmit(reason.trim())}>{many ? `Send ${formatCount(targets.length)} requests for review` : 'Send for review'}</Button>
        </div>
      )}
    >
      <div className="space-y-[12px]">
        {critical.length > 0 && (
          <Notice tone="warning" icon={AlertTriangle} title={critical.length === 1 ? 'This is a critical clause' : `${formatCount(critical.length)} are critical clauses`}>
            {critical.length === 1 && critical[0].control.criticality_reason ? `AI flagged it: ${critical[0].control.criticality_reason}` : 'AI flagged them as critical.'} A reviewer has to approve before {critical.length === 1 ? 'it' : 'they'} can leave the scope.
          </Notice>
        )}
        {skipped && skipped.count > 0 && <p className="m-0 text-ds-body text-ds-fg-muted">{`${skipped.why}, so no request is sent for ${skipped.count === 1 ? 'it' : 'them'}.`}</p>}
        <FormField
          label={applicable ? 'Why should it count again?' : 'Why is it not applicable to your organisation?'}
          required={needed}
          optional={!needed}
          hint="This reason is kept for the audit trail. The requirement stays as it is until a reviewer approves."
        >
          <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} autoFocus />
        </FormField>
      </div>
    </AnimatedModal>
  );
}

export interface BulkOwnersDialogProps {
  open: boolean;
  rows: readonly ReqRow[];
  users: ReadonlyArray<{ id: number; name: string; email?: string | null }>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (picked: number[], mode: OwnerMode) => void;
}

export function BulkOwnersDialog({ open, rows, users, pending, onClose, onSubmit }: BulkOwnersDialogProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<OwnerMode>('add');
  useEffect(() => { if (open) { setPicked([]); setMode('add'); } }, [open]);
  const options: ListOption[] = useMemo(() => users.map((u) => ({ value: String(u.id), label: u.name, description: u.email ?? undefined })), [users]);
  const withdraw = mode === 'replace' && picked.length === 0;
  const ready = mode === 'add' ? picked.length > 0 : true;
  const withOwners = rows.filter((r) => r.ownerIds.length > 0).length;
  return (
    <AnimatedModal
      isOpen={open}
      onClose={onClose}
      dirty={picked.length > 0}
      title="Assign owners"
      subtitle={`${formatCount(rows.length)} ${rows.length === 1 ? 'requirement' : 'requirements'} selected`}
      size="lg"
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={withdraw ? 'dangerOutline' : 'primary'} loading={pending} disabled={!ready} onClick={() => onSubmit(picked.map(Number), mode)}>{withdraw ? 'Withdraw all owners' : 'Assign owners'}</Button>
        </div>
      )}
    >
      <div className="space-y-[12px]">
        <SegmentedControl
          label="What happens to the owners they have now"
          name="bulk-owner-mode"
          value={mode}
          onChange={setMode}
          options={[{ value: 'add', label: 'Add to current owners' }, { value: 'replace', label: 'Replace current owners' }]}
        />
        <FormField label="People" hint={mode === 'add' ? 'Nobody is taken off: the people you choose are added to the owners each requirement has.' : 'Each requirement ends up with exactly the people you choose. Choose nobody to withdraw every owner.'}>
          <MultiSelect label="People" options={options} value={picked} onChange={setPicked} placeholder="Choose people" searchPlaceholder="Search people" />
        </FormField>
        {mode === 'replace' && withOwners > 0 && (
          <Notice tone="warning" title={`${formatCount(withOwners)} ${withOwners === 1 ? 'has' : 'have'} owners already`}>
            {withdraw ? 'They will have no owner afterwards.' : 'Their current owners are replaced.'}
          </Notice>
        )}
      </div>
    </AnimatedModal>
  );
}
