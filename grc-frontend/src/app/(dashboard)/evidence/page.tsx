'use client';

/**
 * Evidence Management: the shell of /evidence. The kit's page head with the Evidence | Settings choice and Upload, the workspace (views, filters, preview) and the
 * Settings panel (shared custom fields, lists and SLA; unchanged). It owns the upload: the form is a right-hand panel; a failed upload is said inside it in the server's
 * words with the form kept (it used to stop the spinner and say nothing), assets that could not be linked are said, and a file that looks like what some common
 * controls ask for gets its suggestion dialog right after. Section, view, filters and the open file live in the address (_workspace/workspaceAddress.ts).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { AxiosResponse } from 'axios';
import { usePermissions } from '@/hooks/usePermissions';
import apiClient, { assetsApi } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { Button, SegmentedControl, useAddressState, useNotify, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { truncate } from '@/lib/format';
import ModuleSettingsPanel from '@/components/settings/ModuleSettingsPanel';
import CommonControlSuggest, { type CommonControlRec } from './_CommonControlSuggest';
import { UploadDrawer, type EvidenceType } from './_UploadDrawer';
import { EvidenceWorkspace } from './_workspace/EvidenceWorkspace';
import { SCHEMA } from './_workspace/workspaceAddress';

type Section = 'records' | 'settings';
const SECTIONS: Array<{ value: Section; label: string }> = [{ value: 'records', label: 'Evidence' }, { value: 'settings', label: 'Settings' }];
const REFRESH = [['evidence-items'], ['evidence-summary'], ['ev-ws-items'], ['ev-ws-summary'], ['ev-ws-expiring']] as const;

export default function EvidencePage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('evidence:evidence_library:create');
  const canDelete = hasPermission('evidence:evidence_library:delete');
  const notify = useNotify();
  const [a, set] = useAddressState(SCHEMA);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  // Common controls the file just uploaded can stand for (offered once, right after the upload).
  const [suggest, setSuggest] = useState<{ id: number; name: string; recs: CommonControlRec[] } | null>(null);

  const { data: evidenceTypes } = useQuery({
    queryKey: ['evidence-types'],
    queryFn: async () => (await apiClient.get('/evidence-mgmt/items/types')).data.types as EvidenceType[],
  });

  const upload = useReportedMutation<{ res: AxiosResponse; linked: number; linkFailures: number }, { formData: FormData; linkedAssetIds: number[] }>({
    mutationFn: async ({ formData, linkedAssetIds }) => {
      const res = await apiClient.post('/evidence-mgmt/items/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      const evidenceId = (res.data as { id?: number })?.id;
      // Link the selected assets after the evidence row exists. A failure here does not roll the upload back (the person can link from the evidence page), but it is said.
      let linkFailures = 0;
      if (evidenceId && linkedAssetIds.length > 0) {
        const results = await Promise.all(linkedAssetIds.map((assetId) => assetsApi.linkEvidence(assetId, { evidence_id: evidenceId }).then(() => true, () => false)));
        linkFailures = results.filter((ok) => !ok).length;
      }
      return { res, linked: linkedAssetIds.length, linkFailures };
    },
    success: (done) => {
      const made = done.res.data as { name?: string; ocr_processing?: boolean } | undefined;
      return `Uploaded “${truncate(made?.name ?? 'the file', 60).text}”.${made?.ocr_processing ? ' The AI is reading and rating it.' : ''}`;
    },
    failure: "Couldn't upload the file",
    retryable: false,                                   // the drawer has its own Retry; a repeat after a lost answer could make a second file
    toast: 'success',                                   // a failure is said inside the drawer, once
    invalidate: REFRESH,
    onSuccess: async (done) => {
      setIsUploadOpen(false);
      if (done.linkFailures) notify.warning(`${done.linkFailures} of ${done.linked} ${done.linked === 1 ? 'asset' : 'assets'} could not be linked. Link them from the evidence page.`);
      // Say which common controls a document like this can stand for, while the person is here.
      const created = done.res.data as { id?: number; name?: string } | undefined;
      if (created?.id) {
        try {
          const r = await apiClient.post(`/evidence-mgmt/ai/${created.id}/recommend-links`, null, { params: { target: 'common_controls' } });
          const recs = (r.data?.recommendations || []) as CommonControlRec[];
          if (recs.length) setSuggest({ id: created.id, name: created.name || 'This file', recs });
        } catch {
          // a bonus: the evidence page offers the same suggestions again
        }
      }
    },
  });

  const openUpload = () => { upload.reset(); setIsUploadOpen(true); };

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title="Evidence Management"
        info="Upload evidence, let the AI read and rate how mature it is, review it, and see which controls and frameworks it supports."
        actions={(
          <>
            <SegmentedControl label="Show" name="evidence-section" options={SECTIONS} value={a.section} onChange={(section: Section) => set({ section })} />
            {canCreate && a.section === 'records' && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={openUpload}>Upload evidence</Button>}
          </>
        )}
      />

      {a.section === 'settings' ? (
        <ModuleSettingsPanel moduleKey="evidence" />
      ) : (
        <EvidenceWorkspace canCreate={canCreate} canDelete={canDelete} onUploadClick={openUpload} address={a} setAddress={set} />
      )}

      {isUploadOpen && (
        <UploadDrawer
          onClose={() => setIsUploadOpen(false)}
          onUpload={(formData, linkedAssetIds) => upload.mutate({ formData, linkedAssetIds })}
          isLoading={upload.isPending}
          error={upload.isError ? errorMessage(upload.error) : null}
          onRetry={upload.isError && canRetry(upload.error) && upload.variables ? () => upload.mutate(upload.variables as { formData: FormData; linkedAssetIds: number[] }) : undefined}
          evidenceTypes={evidenceTypes || []}
        />
      )}

      {suggest && <CommonControlSuggest evidence={{ id: suggest.id, name: suggest.name }} recs={suggest.recs} onClose={() => setSuggest(null)} />}
    </div>
  );
}
