'use client';

/**
 * One assessed risk, over the table: the narrative the cells have no room for (rationale and notes, saved with one button), the AI suggestion, the KRIs, incidents and RCSA findings linked to the
 * risk in this assessment (each linked from a searchable list, each unlinked by a named button), and the 1LINK fields when the risk belongs to the 1LINK register. The scores, treatment and
 * control effectiveness are the table's cells and the drawer's suggestion fills the same cells. Nothing here is a number the person has to know: findings, KRIs and incidents are picked by name.
 */
import { useMemo, useState } from 'react';
import { ArrowUpRight, Link2, Unlink } from 'lucide-react';
import { Button, FormField, IconButton, SidePanel, StatusPill, Textarea, useReportedMutation } from '@/components/ui/ds';
import { useQuery } from '@tanstack/react-query';
import { statusOf } from '@/components/ui/ds/reportOutcome';
import { ermApi, rcsaApi, riskAssessmentApi } from '@/lib/api';
import { statusPill } from '@/lib/status';
import { riskLevel } from '@/lib/statuses/risk';
import { thresholdStatus } from '@/lib/statuses/assessments';
import { AiDraft } from '../../_register/AiDraft';
import { aiFailureWords, ratingOf, sourceOf, type AssessedRisk, type RowPatch } from '../../_register/assessmentModel';
import { ASSESSMENT_REFRESH } from '../../_register/assessmentData';
import { LinkPicker, type PickItem } from '../../../risks/[id]/_workspace/LinkPicker';
import { assessmentKey } from './workspaceData';
import { OneLinkBlock } from './OneLinkBlock';
import { EFFECTIVENESS, TREATMENTS } from './RiskRows';

type Kind = 'kri' | 'incident' | 'rcsa';
interface Suggestion { treatment_decision?: string; control_effectiveness?: string; rationale?: string; notes?: string; source?: string }

const label = (pairs: Array<[string, string]>, v?: string | null) => pairs.find(([k]) => k === v)?.[1] ?? v ?? '';

export interface RiskDrawerProps {
  assessmentId: number;
  row: AssessedRisk | null;
  editable: boolean;
  onClose: () => void;
  /** a change to the row; true once the server has it */
  onSave: (row: AssessedRisk, patch: RowPatch) => Promise<boolean>;
  saving: boolean;
}

function Section({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-[20px] border-t border-ds-border pt-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <h3 className="m-0 !text-ds-body !font-[600] !text-ds-fg">{title}{count != null && <span className="ml-[6px] font-normal text-ds-fg-muted">{count}</span>}</h3>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="mt-[8px]">{children}</div>
    </section>
  );
}

export function RiskDrawer({ assessmentId, row, editable, onClose, onSave, saving }: RiskDrawerProps) {
  const [rationale, setRationale] = useState(row?.rationale ?? '');
  const [notes, setNotes] = useState(row?.notes ?? '');
  const [draft, setDraft] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; answer?: Suggestion; error?: string }>({ state: 'idle' });
  const [picker, setPicker] = useState<Kind | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const dirty = !!row && ((rationale ?? '') !== (row.rationale ?? '') || (notes ?? '') !== (row.notes ?? ''));

  const refresh = [[...assessmentKey(assessmentId)], ...ASSESSMENT_REFRESH];
  const kris = useQuery({ queryKey: ['assessment-pick-kris'], queryFn: async () => ((await ermApi.kris.getAll({ limit: 1000 } as never)).data ?? []) as Array<{ id: number; name?: string; current_status?: string }>, enabled: picker === 'kri', staleTime: 60_000 });
  const incidents = useQuery({ queryKey: ['assessment-pick-incidents'], queryFn: async () => ((await ermApi.incidents.getAll({ limit: 1000 } as never)).data ?? []) as Array<{ id: number; title?: string; severity?: string; status?: string }>, enabled: picker === 'incident', staleTime: 60_000 });
  const findings = useQuery({ queryKey: ['assessment-pick-findings'], queryFn: async () => ((await rcsaApi.getFindings({ limit: 1000 })).data ?? []) as Array<{ id: number; title?: string; severity?: string; status?: string }>, enabled: picker === 'rcsa', staleTime: 60_000 });

  const items: PickItem[] = useMemo(() => {
    if (!row) return [];
    if (picker === 'kri') { const have = new Set((row.linked_kris ?? []).map((k) => k.kri_id)); return (kris.data ?? []).filter((k) => !have.has(k.id)).map((k) => ({ value: String(k.id), label: k.name || 'A KRI', sub: k.current_status ? k.current_status.replace(/_/g, ' ') : undefined })); }
    if (picker === 'incident') { const have = new Set((row.linked_incidents ?? []).map((k) => k.incident_id)); return (incidents.data ?? []).filter((k) => !have.has(k.id)).map((k) => ({ value: String(k.id), label: k.title || 'An incident', sub: [k.severity, k.status].filter(Boolean).join(' · ') || undefined })); }
    const have = new Set((row.linked_rcsa_findings ?? []).map((k) => k.rcsa_finding_id));
    return (findings.data ?? []).filter((k) => !have.has(k.id)).map((k) => ({ value: String(k.id), label: k.title || 'A finding', sub: [k.severity, k.status].filter(Boolean).join(' · ') || undefined }));
  }, [picker, row, kris.data, incidents.data, findings.data]);
  const pickerQuery = picker === 'kri' ? kris : picker === 'incident' ? incidents : findings;

  const link = useReportedMutation<unknown, { kind: Kind; id: number }>({
    mutationFn: ({ kind, id }) => {
      const ar = (row as AssessedRisk).id;
      if (kind === 'kri') return riskAssessmentApi.linkKRI(assessmentId, ar, { kri_id: id });
      if (kind === 'incident') return riskAssessmentApi.linkIncident(assessmentId, ar, { incident_id: id });
      return riskAssessmentApi.linkRCSAFinding(assessmentId, ar, { rcsa_finding_id: id });
    },
    success: (_d, v) => ({ kri: 'KRI linked', incident: 'Incident linked', rcsa: 'RCSA finding linked' })[v.kind],
    failure: "Couldn't link it",
    invalidate: refresh,
    onSuccess: () => setPending(null),
    onError: () => setPending(null),
  });
  const unlink = useReportedMutation<unknown, { kind: Kind; linkId: number }>({
    mutationFn: ({ kind, linkId }) => {
      const ar = (row as AssessedRisk).id;
      if (kind === 'kri') return riskAssessmentApi.unlinkKRI(assessmentId, ar, linkId);
      if (kind === 'incident') return riskAssessmentApi.unlinkIncident(assessmentId, ar, linkId);
      return riskAssessmentApi.unlinkRCSAFinding(assessmentId, ar, linkId);
    },
    success: (_d, v) => ({ kri: 'KRI unlinked', incident: 'Incident unlinked', rcsa: 'RCSA finding unlinked' })[v.kind],
    failure: "Couldn't unlink it",
    invalidate: refresh,
  });

  const suggest = async () => {
    if (!row) return;
    setDraft({ state: 'loading' });
    try {
      const res = await riskAssessmentApi.aiSuggestRisk(assessmentId, row.id);
      setDraft({ state: 'ready', answer: res.data as Suggestion });
    } catch (e) {
      setDraft({ state: 'error', error: aiFailureWords(statusOf(e) ?? undefined) });
    }
  };
  const a = draft.answer;
  const rows = a ? [
    { key: 'treatment', label: 'Treatment decision', value: label(TREATMENTS, a.treatment_decision), onUse: editable && a.treatment_decision ? () => { void onSave(row as AssessedRisk, { treatment_decision: a.treatment_decision }); } : undefined },
    { key: 'effectiveness', label: 'Control effectiveness', value: label(EFFECTIVENESS, a.control_effectiveness), onUse: editable && a.control_effectiveness ? () => { void onSave(row as AssessedRisk, { control_effectiveness: a.control_effectiveness }); } : undefined },
    { key: 'rationale', label: 'Rationale', value: a.rationale, onUse: editable ? () => setRationale(a.rationale ?? '') : undefined },
    { key: 'notes', label: 'Notes', value: a.notes, onUse: editable ? () => setNotes(a.notes ?? '') : undefined },
  ] : [];

  const saveText = async () => { if (row && (await onSave(row, { rationale: rationale || null, notes: notes || null }))) { /* the row now holds the text */ } };

  const linkList = (kind: Kind, list: Array<{ id: number; name: string; sub?: ReactLike }>, none: string, add: string) => (
    <Section
      title={{ kri: 'KRIs', incident: 'Incidents', rcsa: 'RCSA findings' }[kind]}
      count={list.length}
      action={editable ? <Button size="sm" leftIcon={<Link2 aria-hidden />} onClick={() => setPicker(kind)}>{add}</Button> : undefined}
    >
      {list.length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">{none}</p> : (
        <ul className="m-0 list-none p-0">
          {list.map((l) => (
            <li key={l.id} className="flex min-h-[44px] items-center gap-[8px] border-b border-ds-border py-[4px] last:border-b-0">
              <div className="min-w-0 flex-1"><p dir="auto" className="m-0 break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{l.name}</p>{l.sub && <div className="text-ds-label text-ds-fg-muted">{l.sub}</div>}</div>
              {editable && <IconButton label={`Unlink ${l.name}`} disabled={unlink.isPending} onClick={() => unlink.mutate({ kind, linkId: l.id })}><Unlink aria-hidden /></IconButton>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );

  return (
    <>
      <SidePanel
        open={!!row}
        onClose={onClose}
        title={<span dir="auto" className="line-clamp-3 break-words" title={row?.risk_title ?? undefined}>{row?.risk_title || 'A risk no longer in the register'}</span>}
        subtitle={row?.risk_category ? row.risk_category.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : undefined}
        dockFrom={Infinity}
        width="md"
        dirty={dirty}
        footer={row && (
          <div className="flex flex-wrap items-center gap-[8px]">
            {editable && <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => { void saveText(); }}>Save rationale and notes</Button>}
            <Button href={`/erm/risks/${row.risk_id}`} rightIcon={<ArrowUpRight aria-hidden />}>Open the risk</Button>
          </div>
        )}
      >
        {row && (
          <div key={row.id}>
            <div className="mb-[16px] flex flex-wrap items-center gap-[8px]"><StatusPill {...statusPill(riskLevel, ratingOf(row))} /></div>

            <div className="flex flex-col gap-[12px]">
              <FormField label="Rationale" optional hint="Why these scores and this decision.">
                <Textarea rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} disabled={!editable} />
              </FormField>
              <FormField label="Notes" optional>
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} />
              </FormField>
            </div>

            {editable && (
              <div className="mt-[16px]">
                <AiDraft state={draft.state} source={sourceOf(a)} rows={rows} error={draft.error} onRun={() => { void suggest(); }} idleText="Drafts a treatment decision, control effectiveness, rationale and notes from the scores and the KRIs, incidents and findings linked below." />
              </div>
            )}

            {linkList('kri', (row.linked_kris ?? []).map((k) => ({ id: k.id, name: k.kri_name || 'A KRI', sub: <>{k.observed_value != null && <span>Value {k.observed_value}</span>}{k.threshold_status && <span className="ml-[8px]"><StatusPill size="sm" {...statusPill(thresholdStatus, k.threshold_status)} /></span>}</> })), 'No KRI is linked to this risk in this assessment.', 'Link a KRI')}
            {linkList('incident', (row.linked_incidents ?? []).map((k) => ({ id: k.id, name: k.incident_title || 'An incident', sub: k.impact_on_rating ? `Effect on the rating: ${k.impact_on_rating}` : k.incident_severity ? `Severity ${k.incident_severity}` : undefined })), 'No incident is linked.', 'Link an incident')}
            {linkList('rcsa', (row.linked_rcsa_findings ?? []).map((k) => ({ id: k.id, name: k.finding_title || 'An RCSA finding', sub: k.relevance_notes || undefined })), 'No RCSA finding is linked.', 'Link a finding')}

            <OneLinkBlock riskId={row.risk_id} editable={editable} />
          </div>
        )}
      </SidePanel>

      <LinkPicker
        open={!!picker}
        onClose={() => setPicker(null)}
        title={picker === 'kri' ? 'Link a KRI' : picker === 'incident' ? 'Link an incident' : 'Link an RCSA finding'}
        searchLabel={picker === 'kri' ? 'Search KRIs' : picker === 'incident' ? 'Search incidents' : 'Search RCSA findings'}
        items={items}
        loading={!!picker && pickerQuery.isPending}
        error={pickerQuery.isError ? pickerQuery.error : null}
        onRetry={() => { void pickerQuery.refetch(); }}
        pending={pending}
        empty={picker === 'kri' ? 'Every KRI is already linked, or there are none.' : picker === 'incident' ? 'Every incident is already linked, or there are none.' : 'Every finding is already linked, or there are none.'}
        onPick={(value) => { if (!picker) return; setPending(value); link.mutate({ kind: picker, id: Number(value) }); }}
      />
    </>
  );
}

type ReactLike = React.ReactNode;
