'use client';

// Edit a control the organisation wrote: the same form as "New control", with its code locked. The dialog asks before it throws typed input away (Escape, the X and a press outside all ask).
// The form is mounted afresh each time it opens, so it never shows the edits of a closed attempt.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, useReportedMutation } from '@/components/ui/ds';
import { AnimatedModal } from '@/components/ui';
import { CustomControlForm, toWriteBody, type CustomControlFormValues } from '@/components/soc2/CustomControlForm';
import { automationApi, scfApi, type ControlRecordLink, type CustomControlProfile } from '@/lib/api';
import { useWorkspace } from './workspaceContext';

const dateOnly = (v?: string | null) => (v ? String(v).slice(0, 10) : '');

export function EditControlDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { code, d, refresh } = useWorkspace();
  const [dirty, setDirty] = useState(false);
  const links = useQuery({ queryKey: ['control-links', code], enabled: open, queryFn: async () => (await automationApi.listControlLinks(code)).data.items as ControlRecordLink[] });
  const custom = useQuery({ queryKey: ['scf-custom-control', code], enabled: open, queryFn: async () => (await scfApi.getCustomControl(code)).data });
  const linked = links.data ?? [];
  const save = useReportedMutation({
    // One call: the control's own fields, its register profile, owner and priority, its SCF mappings and its links. Link types that were present before the edit are sent even when now
    // empty, so removals apply.
    mutationFn: (v: CustomControlFormValues) => scfApi.updateCustomControl(code, toWriteBody(v, Array.from(new Set(linked.map((r) => r.type))))),
    success: { title: 'Control updated', message: 'Your changes are saved.' },
    failure: "Couldn't save the control",
    onSuccess: () => { setDirty(false); onClose(); void refresh(); },
  });
  const c = custom.data;
  const profile = (d.profile || c?.profile) as CustomControlProfile | undefined;
  const initial: Partial<CustomControlFormValues> = {
    code: d.control_id,
    name: c?.name || d.title || '',
    statement: c?.statement || d.description || '',
    domain: c?.domain || d.domain || '',
    pptdf: c?.pptdf || d.implementation?.pptdf || '',
    conformity_cadence: c?.conformity_cadence || d.implementation?.conformity_cadence || 'Annual',
    control_sub_type: c?.control_sub_type || d.sub_type || 'Manual',
    implements_scf_ids: c?.implements_scf_ids || d.implements_scf_ids || [],
    category: profile?.category || '',
    sub_category: profile?.sub_category || '',
    control_type: profile?.control_type || '',
    operating_frequency: profile?.operating_frequency || '',
    department_id: profile?.department_id ?? null,
    backup_owner_id: profile?.backup_owner_id ?? null,
    owner_user_id: d.owner_user_id ?? null,
    reviewer_user_id: d.reviewer_user_id ?? null,
    priority: d.priority || 'medium',
    is_key_control: !!d.is_key_control,
    regulatory_source: profile?.regulatory_source || '',
    effective_date: dateOnly(profile?.effective_date),
    review_date: dateOnly(profile?.review_date),
    objective: (c?.objective as string | undefined) || d.implementation?.objective || '',
    implementation_guidance: (c?.implementation_guidance as string | undefined) || d.implementation?.guidance || '',
    testing_guidance: (c?.testing_guidance as string | undefined) || d.implementation?.testing_guidance || '',
    recommended_evidence: ((c?.recommended_evidence as CustomControlFormValues['recommended_evidence']) || []),
    links: linked,
  };
  const ready = !links.isPending && !custom.isPending;
  return (
    <AnimatedModal
      isOpen={open}
      onClose={() => { setDirty(false); onClose(); }}
      dirty={dirty}
      title="Edit this control"
      subtitle={`${d.control_id} · ${d.title}`}
      size="3xl"
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button onClick={() => { setDirty(false); onClose(); }}>Cancel</Button>
          <Button type="submit" form="edit-custom-control" variant="primary" loading={save.isPending} disabled={!ready}>Save changes</Button>
        </div>
      )}
    >
      {open && (ready
        ? <CustomControlForm key={`${code}-open`} formId="edit-custom-control" hideActions initial={initial} codeLocked showImplements submitLabel="Save changes" pending={save.isPending} onCancel={onClose} onSubmit={(v) => save.mutate(v)} onDirtyChange={setDirty} />
        : <p className="text-ds-body text-ds-fg-muted">Loading the control…</p>)}
    </AnimatedModal>
  );
}
