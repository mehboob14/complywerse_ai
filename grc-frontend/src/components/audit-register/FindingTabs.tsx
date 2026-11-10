'use client';

// The four tabs of one finding (Fields, Validation, Extension, Links), shared by the register's drawer and by the panel on the issue page (RegisterPanel). The Validation tab is left out for a
// kind of finding that has no validation step (a self-identified event). Which tab opens first follows the work: a finding waiting for validation opens on Validation for the person who decides it.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabPanel } from '@/components/ui/ds';
import { auditRegisterApi } from '@/lib/api';
import { can, type RegisterRights } from '@/lib/auditRegister/rights';
import { ExtensionPanel } from './ExtensionPanel';
import { FieldsPanel } from './FieldsPanel';
import { LinksPanel } from './LinksPanel';
import type { ValidationState } from './ValidationPanel';
import { ValidationPanel } from './ValidationPanel';

export type FindingTab = 'fields' | 'validation' | 'extension' | 'links';

export function FindingTabs({ issueId, rights, subject, owner, initialTab = 'fields', onDirtyChange }: {
  issueId: number; rights: RegisterRights; subject: string; owner?: string | null; initialTab?: FindingTab; onDirtyChange?: (dirty: boolean) => void;
}) {
  // until the person picks a tab the first one follows the work (the register's rows may arrive after the drawer opened from a notification's link)
  const [picked, setTab] = useState<FindingTab | null>(null);
  const tab = picked ?? initialTab;
  // asked once here and read again by the tab (same query key): whether this kind of finding has a validation step at all
  const validation = useQuery<ValidationState>({
    queryKey: ['audit-register-validation', issueId], retry: false,
    queryFn: async () => (await auditRegisterApi.validation(issueId)).data as ValidationState,
  });
  const hasValidation = validation.data ? validation.data.has_validation : true;
  const open: FindingTab = tab === 'validation' && !hasValidation ? 'fields' : tab;
  return (
    <Tabs
      ariaLabel="About this finding" value={open} onChange={setTab}
      tabs={[
        { key: 'fields', label: 'Fields' },
        { key: 'validation', label: 'Validation', hidden: !hasValidation },
        { key: 'extension', label: 'Extension' },
        { key: 'links', label: 'Links' },
      ]}
      className="-mt-[4px]"
    >
      <TabPanel tabKey="fields" className="pt-[12px]"><FieldsPanel issueId={issueId} canEdit={can(rights, 'editFields')} onDirtyChange={onDirtyChange} /></TabPanel>
      <TabPanel tabKey="validation" lazy className="pt-[12px]"><ValidationPanel issueId={issueId} subject={subject} owner={owner} rights={rights} /></TabPanel>
      <TabPanel tabKey="extension" lazy className="pt-[12px]"><ExtensionPanel issueId={issueId} rights={rights} /></TabPanel>
      <TabPanel tabKey="links" lazy className="pt-[12px]"><LinksPanel issueId={issueId} rights={rights} /></TabPanel>
    </Tabs>
  );
}
