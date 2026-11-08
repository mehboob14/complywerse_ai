'use client';

// "Move to the risk register": makes a risk from a register row, linked back to the row and tagged under the framework. The title is required (it is
// the risk's name); what the person typed is kept when the move fails, and the failure is said here, with Retry.
import { useState } from 'react';
import { AnimatedModal } from '@/components/ui';
import { Button, FormError, FormField, Textarea, TextInput } from '@/components/ui/ds';

interface Props {
  /** the register's name ("Gap Analysis") and the framework, for the sentence */
  register: string;
  frameworkName: string;
  initialTitle: string;
  pending: boolean;
  problem: unknown;
  onSubmit: (title: string, description: string) => void;
  onClose: () => void;
}

export default function MoveToRiskDialog({ register, frameworkName, initialTitle, pending, problem, onSubmit, onClose }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState('');
  const ready = title.trim().length > 0;
  const send = () => onSubmit(title.trim(), description.trim());
  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      dirty={title !== initialTitle || description.length > 0}
      title="Move to the risk register"
      subtitle={frameworkName}
      size="md"
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} disabled={!ready} onClick={send}>Create risk</Button>
        </div>
      )}
    >
      <div className="space-y-[12px] p-[20px]">
        <p className="text-ds-body text-ds-fg-muted">
          A risk is created in the risk register from this {register.toLowerCase()} row, linked back to it and tagged under {frameworkName}.
        </p>
        <FormError title="Couldn't create the risk" error={problem} onRetry={ready ? send : undefined} />
        <FormField label="Risk title" required>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} autoFocus />
        </FormField>
        <FormField label="Description" optional>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything the risk owner should know" maxLength={2000} />
        </FormField>
      </div>
    </AnimatedModal>
  );
}
