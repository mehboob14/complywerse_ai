'use client';

// What only a control the organisation wrote has: its register fields and the tests attached to it. (An SCF control's wording is the Secure Controls Framework's and is never edited here.)
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button, Fact, FactList, FormField, IconButton, SectionCard, TextInput, useReportedMutation } from '@/components/ui/ds';
import { scfApi } from '@/lib/api';
import { formatDate, statusLabel } from '@/lib/format';
import { Small } from './parts';
import type { ControlDetail } from './types';
import { useWorkspace } from './workspaceContext';

/** The register fields of a custom control (category, type, department, owner of the backup, dates). */
export function RegisterCard({ d }: { d: ControlDetail }) {
  const p = d.profile || {};
  return (
    <SectionCard id="register" title="Control register" meta={d.is_key_control ? 'Key control' : undefined}>
      <FactList min={150}>
        <Fact label="Category">{[p.category, p.sub_category].filter(Boolean).join(' · ') || null}</Fact>
        <Fact label="Control type">{p.control_type ? statusLabel(p.control_type) : null}</Fact>
        <Fact label="Operates">{p.operating_frequency ? statusLabel(p.operating_frequency) : null}</Fact>
        <Fact label="Department">{p.department_name}</Fact>
        <Fact label="Backup owner" empty="Unassigned">{p.backup_owner_name}</Fact>
        <Fact label="Regulatory source">{p.regulatory_source}</Fact>
        <Fact label="Effective from">{p.effective_date ? formatDate(p.effective_date, { calendar: true }) : null}</Fact>
        <Fact label="Next review">{p.review_date ? formatDate(p.review_date, { calendar: true }) : null}</Fact>
        <Fact label="Priority">{d.priority ? statusLabel(d.priority) : null}</Fact>
      </FactList>
      {p.submitted_at && (
        <Small className="mt-[12px] border-t border-ds-border pt-[8px]">
          {`Submitted${p.submitted_by_name ? ` by ${p.submitted_by_name}` : ''} on ${formatDate(p.submitted_at)}`}
          {p.approved_at ? ` · approved${p.approved_by_name ? ` by ${p.approved_by_name}` : ''} on ${formatDate(p.approved_at)}` : ''}
        </Small>
      )}
    </SectionCard>
  );
}

/** Tests attached to a custom control: the control then takes its status from their results. A test is named by its reference (listed under each connector on the Connections page). */
export function AttachedTests({ initial }: { initial: readonly string[] }) {
  const { code, rights, why, refresh } = useWorkspace();
  const [ids, setIds] = useState<string[]>([...initial]);
  const [draft, setDraft] = useState('');
  const key = initial.join('\n');
  useEffect(() => { setIds([...initial]); }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const add = () => {
    const t = draft.trim().replace(/,$/, '');
    if (t && !ids.includes(t)) setIds([...ids, t]);
    setDraft('');
  };
  const save = useReportedMutation({
    mutationFn: () => {
      const pending = draft.trim();
      return scfApi.setCustomControlChecks(code, { check_ids: pending && !ids.includes(pending) ? [...ids, pending] : ids });
    },
    success: { title: 'Tests attached', message: 'The control takes its status from their results.' },
    failure: "Couldn't attach the tests",
    onSuccess: () => { setDraft(''); void refresh(); },
  });
  const off = !rights.libraryEdit;
  return (
    <SectionCard id="attached-tests" title="Attached tests" info="Attach connector tests by their reference. The control then takes its status from their results.">
      <FormField label="Add a test" hint={off ? why('libraryEdit') : 'A reference looks like okta.org_mfa_enforced. Press Enter to add it.'}>
        <TextInput
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
          onBlur={add}
          disabled={off}
          className="max-w-[420px]"
        />
      </FormField>
      {ids.length > 0 && (
        <ul className="mt-[8px] flex flex-wrap gap-[6px]" aria-label="Attached tests">
          {ids.map((id) => (
            <li key={id} className="inline-flex max-w-full items-center gap-[4px] rounded-ds-control border border-ds-border bg-ds-surface-subtle py-[2px] pl-[8px] pr-[2px] font-mono text-ds-label text-ds-fg-body">
              <span className="min-w-0 truncate">{id}</span>
              <IconButton label={`Remove ${id}`} disabled={off} onClick={() => setIds(ids.filter((x) => x !== id))}><X aria-hidden strokeWidth={1.75} /></IconButton>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-[12px]"><Button variant="primary" loading={save.isPending} disabled={off} onClick={() => save.mutate()}>Save tests</Button></div>
    </SectionCard>
  );
}
