'use client';

// The details of a framework document (who owns, reviews and approves it, its version, classification, dates and status), in a right panel. What is typed
// changes the open document at once and stays unsaved until it is saved, as the document's own text does; "Save" here is the same save.
import { RotateCcw } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import { Button, Combobox, FormField, Notice, Select, TextInput } from '@/components/ui/ds';
import { UNASSIGNED } from '@/lib/format';
import { frameworkDocumentStatus } from '@/lib/statuses/frameworkRegisters';
import { CLASSIFICATIONS, DOC_STATUSES, canSendForReview, type FrameworkDoc } from './documentModel';

interface Props {
  doc: FrameworkDoc;
  people: Array<{ id: number; name: string }>;
  set: <K extends keyof FrameworkDoc>(key: K, value: FrameworkDoc[K]) => void;
  /** the person pressed "Send for review" without a reviewer and an approver */
  askedForReviewers: boolean;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export default function DocumentDetails({ doc, people, set, askedForReviewers, dirty, saving, onSave, onReset, onClose }: Props) {
  const options = people.map((p) => ({ value: String(p.id), label: p.name }));
  const approvedBy = doc.approved_by && !people.some((p) => p.name === doc.approved_by) ? [{ value: doc.approved_by, label: doc.approved_by }] : [];
  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title="Document details"
      subtitle={doc.title || undefined}
      width="w-full max-w-[480px]"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <Button variant="link" leftIcon={<RotateCcw aria-hidden />} onClick={onReset}>Reset sections to the template</Button>
          <div className="flex gap-[8px]">
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" loading={saving} disabled={!dirty} onClick={onSave}>Save</Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-[16px]">
        {askedForReviewers && !canSendForReview(doc) && (
          <Notice tone="warning" title="A reviewer and an approver are needed">Choose both below, then send the document for review.</Notice>
        )}
        <FormField label="Title"><TextInput value={doc.title || ''} onChange={(e) => set('title', e.target.value)} placeholder="Document title" /></FormField>
        <FormField label="Organisation"><TextInput value={doc.organization || ''} onChange={(e) => set('organization', e.target.value)} placeholder="Company name" /></FormField>
        <div className="grid grid-cols-2 gap-[12px]">
          <FormField label="Classification">
            <Select value={doc.classification || 'internal'} onChange={(e) => set('classification', e.target.value)}>
              {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
            </Select>
          </FormField>
          <FormField label="Version"><TextInput value={doc.version || ''} onChange={(e) => set('version', e.target.value)} placeholder="1.0" /></FormField>
        </div>
        <FormField label="Document owner">
          <Select placeholder={doc.owner_name || UNASSIGNED} value={doc.owner_id ?? ''} onChange={(e) => set('owner_id', e.target.value ? Number(e.target.value) : null)}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Reviewer">
          <Combobox label="Reviewer" options={options} value={doc.reviewer_id != null ? String(doc.reviewer_id) : null} onChange={(v) => set('reviewer_id', v ? Number(v) : null)} placeholder="Choose a reviewer" searchPlaceholder="Search people" emptyText="No people" clearable />
        </FormField>
        <FormField label="Approver">
          <Combobox label="Approver" options={options} value={doc.approver_id != null ? String(doc.approver_id) : null} onChange={(v) => set('approver_id', v ? Number(v) : null)} placeholder="Choose an approver" searchPlaceholder="Search people" emptyText="No people" clearable />
        </FormField>
        <FormField label="Approved by">
          <Combobox
            label="Approved by"
            options={[...approvedBy, ...people.map((p) => ({ value: p.name, label: p.name }))]}
            value={doc.approved_by || null}
            onChange={(v) => set('approved_by', v)}
            placeholder="Not set"
            searchPlaceholder="Search people"
            emptyText="No people"
            clearable
          />
        </FormField>
        <div className="grid grid-cols-2 gap-[12px]">
          <FormField label="Effective date"><TextInput type="date" value={doc.effective_date ? doc.effective_date.slice(0, 10) : ''} onChange={(e) => set('effective_date', e.target.value || null)} /></FormField>
          <FormField label="Next review"><TextInput type="date" value={doc.next_review_date ? doc.next_review_date.slice(0, 10) : ''} onChange={(e) => set('next_review_date', e.target.value || null)} /></FormField>
        </div>
        <FormField label="Status">
          <Select value={doc.status || 'draft'} onChange={(e) => set('status', e.target.value)}>
            {DOC_STATUSES.map((s) => <option key={s} value={s}>{frameworkDocumentStatus.label(s)}</option>)}
          </Select>
        </FormField>
      </div>
    </RightSlidePanel>
  );
}
