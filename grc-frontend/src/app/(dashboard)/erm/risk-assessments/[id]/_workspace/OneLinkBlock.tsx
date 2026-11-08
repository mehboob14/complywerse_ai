'use client';

/**
 * The 1LINK register's assessment fields (business impact, gross risk, control design, residual and response) for a risk that belongs to the 1LINK register, inside the risk's drawer. They save
 * straight onto the risk's own template fields, so the register row and the assessment stay in step. The register risk is read when the drawer opens (one request for that risk), not as the first
 * 100 risks of the whole register as the old page did, so a 1LINK risk beyond the 100th is no longer missing its fields.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { Button, Disclosure, ErrorState, Skeleton, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { adminApi, ermApi } from '@/lib/api';
import OneLinkRegisterFields, { ONELINK_ASSESSMENT_GROUP_TITLES, deriveCore, initOneLinkValue, isOneLinkRegisterType, type OneLinkValue } from '../../../risks/_components/OneLinkRegisterFields';

interface RegisterRisk { id: number; register_type?: string | null; template_fields?: Record<string, unknown> | null; updated_at?: string | null }

function Fields({ risk, editable }: { risk: RegisterRisk; editable: boolean }) {
  const [fields, setFields] = useState<OneLinkValue>(() => initOneLinkValue(risk.template_fields));
  const [dirty, setDirty] = useState(false);
  const users = useQuery({
    queryKey: ['onelink-assessment-users'],
    queryFn: async () => { try { return ((await adminApi.getUsers()).data || []) as Array<{ email?: string; full_name?: string; first_name?: string; last_name?: string }>; } catch { return []; } },
    staleTime: 60_000,
  });
  const incidents = useQuery({
    queryKey: ['onelink-assessment-incidents'],
    queryFn: async () => { try { return ((await ermApi.incidents.getAll()).data || []) as Array<{ id: number; title?: string }>; } catch { return []; } },
    staleTime: 60_000,
  });
  const lookups = useMemo(() => ({
    users: (users.data || []).map((u) => u.full_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || '').filter(Boolean),
    incidents: (incidents.data || []).map((i) => `INC-${i.id}${i.title ? ` · ${i.title}` : ''}`),
  }), [users.data, incidents.data]);
  const save = useReportedMutation({
    mutationFn: () => ermApi.risks.update(risk.id, { template_fields: fields, ...deriveCore(fields) } as never),
    success: { title: '1LINK fields saved', message: 'The register shows the same values.' },
    failure: "Couldn't save the 1LINK fields",
    invalidate: [['erm-risk-detail', risk.id], ['risk-detail', risk.id], ['erm-risks-lean']],
    onSuccess: () => setDirty(false),
  });
  return (
    <div>
      <OneLinkRegisterFields value={fields} onChange={(next) => { if (!editable) return; setFields(next); setDirty(true); }} lookups={lookups} groups={ONELINK_ASSESSMENT_GROUP_TITLES} />
      {editable && dirty && (
        <div className="mt-[12px] flex justify-end"><Button variant="primary" loading={save.isPending} leftIcon={<Save aria-hidden />} onClick={() => save.mutate()}>Save 1LINK fields</Button></div>
      )}
    </div>
  );
}

/** Nothing for a risk that is not in the 1LINK register (and while its register entry is read, nothing that looks like an answer). */
export function OneLinkBlock({ riskId, editable }: { riskId: number; editable: boolean }) {
  const q = useQuery({
    queryKey: ['erm-risk-detail', riskId],
    queryFn: async () => (await ermApi.risks.getDetail(riskId)).data as unknown as RegisterRisk,
    retry: (failures, e) => failures < 2 && canRetry(e),
  });
  if (q.isPending) return <Skeleton className="h-[14px] w-[50%]" />;
  if (q.isError) return <ErrorState compact title="Couldn't read the register entry" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
  if (!q.data || !isOneLinkRegisterType(q.data.register_type)) return null;
  return (
    <section className="mt-[20px] border-t border-ds-border pt-[16px]">
      <Disclosure label="1LINK assessment fields" defaultOpen={false}>
        <Fields key={`${q.data.id}-${q.data.updated_at ?? ''}`} risk={q.data} editable={editable} />
      </Disclosure>
    </section>
  );
}
