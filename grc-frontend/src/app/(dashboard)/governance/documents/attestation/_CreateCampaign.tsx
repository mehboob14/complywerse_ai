'use client';

// Start an attestation for a published document: a drawer that asks "Discard changes?" before it throws typed input away. The campaign is started active
// (as it always was), and the server closes the document's previous active campaign when it is. The fields are the kit's; the due date is a day, sent as
// midnight exactly as before. The create is reported by useReportedMutation and is not offered a Retry (a second try could start a second campaign): the
// drawer stays open with everything typed, so Create can be pressed again.
import { useState } from 'react';
import { governanceApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { Button, FormField, Select, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import type { Campaign, PublishedDoc } from './_types';

export function CreateCampaignDrawer({ documents, onClose, onCreated }: {
  documents: PublishedDoc[];
  onClose: () => void;
  onCreated: (c: Campaign) => void;
}) {
  const [documentId, setDocumentId] = useState<number | ''>('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [tried, setTried] = useState(false);

  const create = useReportedMutation({
    mutationFn: async () => {
      const res = await governanceApi.createDocAttestationCampaign({
        document_id: Number(documentId),
        name: name || undefined,
        message: message || undefined,
        due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
        activate: true,
      });
      return res.data as Campaign;
    },
    success: { title: 'Attestation created', message: 'Share the external link with your organization.' },
    failure: 'Not created',
    retryable: false,
    invalidate: [['doc-attest-campaigns'], ['gov-docs-coverage']],
    onSuccess: onCreated,
  });

  const submit = () => {
    setTried(true);
    if (documentId) create.mutate();
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title="New attestation"
      widthClassName="w-[560px] max-w-full"
      dirty={documentId !== '' || name !== '' || message !== '' || dueDate !== ''}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>Create</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <FormField label="Document" required error={tried && !documentId ? 'Select a document' : undefined}
          info="Choose a published document. Its link lets anyone acknowledge it with name, organisation email, designation and signature. Name, due date and message are optional."
          hint={documents.length === 0 ? 'No published documents. Publish one first.' : undefined}>
          <Select placeholder="Select a document…" value={documentId} onChange={(e) => setDocumentId(e.target.value ? Number(e.target.value) : '')}>
            {documents.map((d) => <option key={d.id} value={d.id}>{d.title}{d.current_version ? ` (v${d.current_version})` : ''}</option>)}
          </Select>
        </FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Name"><TextInput value={name} maxLength={255} placeholder="e.g. Q3 acknowledgment" onChange={(e) => setName(e.target.value)} /></FormField>
          <FormField label="Due date"><TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></FormField>
        </div>
        <FormField label="Message" info="People see this message on the acknowledgment page that the link opens.">
          <Textarea rows={3} value={message} placeholder="Please review this policy and acknowledge that you have read it." onChange={(e) => setMessage(e.target.value)} />
        </FormField>
      </div>
    </RightSlidePanel>
  );
}
