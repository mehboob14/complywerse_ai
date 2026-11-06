'use client';

/**
 * The first click of a new assessment: say what it is of. An application is chosen from the asset library; a function or process is named. That makes a
 * draft (nothing is asked yet, no question is copied) and the person lands on its page, where the scope, the people and the plan are filled in as
 * they are known, by whoever knows them, and Start opens the questionnaire.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, FormField, Notice, StatusPill, TextInput } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { AssetPicker } from './AssetPicker';
import { TYPE_INFO } from './scopingModel';
import { refreshAssessmentLists, scopingApi, type AssetRow } from './scopingApi';

export function assessmentHref(id: number): string {
  return `/cyber-security/assessments/${id}`;
}

export default function StartDialog({ format, onClose }: { format: string; onClose: () => void }) {
  const info = TYPE_INFO[format];
  const router = useRouter();
  const qc = useQueryClient();
  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [subject, setSubject] = useState('');
  const asAsset = info.model === 'asset';
  const make = useMutation({
    mutationFn: () => scopingApi.initiate({ assessment_format: format, ...(asAsset ? { asset_id: asset?.id } : { subject: subject.trim() }) }),
    onSuccess: (made) => {
      refreshAssessmentLists(qc);
      qc.setQueryData(['scoping', made.id], made);
      router.push(assessmentHref(made.id));
    },
  });
  const ready = asAsset ? !!asset : subject.trim().length > 0;

  return (
    <AnimatedModal isOpen onClose={onClose} title={`New ${info.label} assessment`} size="lg" dirty={!!asset || !!subject.trim()}
      subtitle={`Which ${info.subject} is it of?`}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" rightIcon={<ArrowRight aria-hidden />} loading={make.isPending} disabled={!ready} onClick={() => make.mutate()}>Create draft</Button></div>}>
      <div className="space-y-[16px] px-[20px] py-[16px]">
        {asAsset ? (
          <>
            {asset ? (
              <div className="flex flex-wrap items-center gap-[8px] rounded-ds-card border border-ds-primary bg-ds-primary-soft p-[10px]">
                <span className="text-ds-body font-[600] text-ds-fg">{asset.name}</span>
                {asset.asset_type && <StatusPill tone="neutral" size="sm" label={asset.asset_type} />}
                <Button size="sm" className="ml-auto" onClick={() => setAsset(null)}>Choose another</Button>
              </div>
            ) : (
              <AssetPicker applicationsFirst autoFocus onPick={setAsset} label="Search for the application" />
            )}
            <p className="text-ds-label text-ds-fg-muted">The owner, environment and related assets come from the asset library; you confirm them in the scope.</p>
          </>
        ) : (
          <FormField label={`The ${info.subject} to assess`} required hint={`For example: ${format === 'itsecops_maturity' ? 'Security Operations Centre' : format === 'cti_maturity' ? 'Enterprise threat intelligence' : format === 'csir_maturity' ? 'Enterprise CSIRT' : 'Security incident management'}.`}>
            <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && ready && !make.isPending) make.mutate(); }} />
          </FormField>
        )}
        {make.isError && <Notice tone="danger" title="Couldn't create the draft">{errorMessage(make.error)}</Notice>}
      </div>
    </AnimatedModal>
  );
}
