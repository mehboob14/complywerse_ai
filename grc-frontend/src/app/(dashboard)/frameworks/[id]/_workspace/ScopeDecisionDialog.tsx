'use client';

// The question "why is this requirement out of scope?": opened from a requirement row or from the requirement popup. A reason is required (it is the
// audit trail), and the dialog says what will happen: the server keeps the request for a reviewer and the requirement stays as it is until then.
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
import { Button, FormField, Notice, Textarea } from '@/components/ui/ds';

interface Props {
  /** the requirement asked about; null keeps the dialog shut */
  control: { control_code?: string; original_reference?: string; control_name?: string; is_critical?: boolean; criticality_reason?: string | null } | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (justification: string) => void;
}

export default function ScopeDecisionDialog({ control, pending, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (control) setReason(''); }, [control]);
  const ready = reason.trim().length > 0;

  return (
    <AnimatedModal
      isOpen={!!control}
      onClose={onClose}
      dirty={reason.trim().length > 0}
      title="Ask to put this requirement out of scope"
      subtitle={control ? `${control.control_code || control.original_reference || ''} ${control.control_name || ''}`.trim() : undefined}
      size="lg"
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} disabled={!ready} onClick={() => onSubmit(reason.trim())}>Send for review</Button>
        </div>
      )}
    >
      <div className="space-y-[12px]">
        {control?.is_critical && (
          <Notice tone="warning" icon={AlertTriangle} title="This is a critical clause">
            {control.criticality_reason ? `AI flagged it: ${control.criticality_reason}` : 'AI flagged it as critical.'} A reviewer has to approve before it can leave the scope.
          </Notice>
        )}
        <FormField label="Why is it not applicable to your organisation?" required hint="This reason is kept for the audit trail. The requirement stays in scope until a reviewer approves.">
          <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} autoFocus />
        </FormField>
      </div>
    </AnimatedModal>
  );
}
