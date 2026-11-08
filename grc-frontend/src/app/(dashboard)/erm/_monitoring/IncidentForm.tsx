'use client';

// Report / edit an incident: the kit's side panel (focus, Escape, "Discard changes?" when something was typed). The four link lists are read when the form opens. An existing
// incident is saved only once its links have been read: the server REPLACES the links whenever a link list is sent (an empty one too), so a save made before they loaded or
// after the read failed would erase them all (lib/erm/incident.ts mayBeSaved / linkPayload). A failed read says so and offers Retry; the Save button waits.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import { Button, Combobox, ErrorState, FormField, MultiSelect, Notice, Select, Textarea, TextInput } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { assetsApi, ermApi, evidenceApi, vulnManagementApi } from '@/lib/api';
import {
  INCIDENT_SEVERITIES, INCIDENT_STATUSES, LINK_KEYS, linkPayload, mayBeSaved, parseTags, type LinkSet, type LinksState,
} from '@/lib/erm/incident';
import { incidentStatus, optionsOf, severity } from '@/lib/statuses/monitoring';
import { useReportedMutation } from '@/components/ui/ds';
import type { IncidentRow } from './incidentModel';
import { personOptions, riskOptions, useLeanRisks, useTenantUsers } from '@/components/records/lookups';

const EMPTY_LINKS: LinkSet = { linked_asset_ids: [], linked_vulnerability_ids: [], linked_risk_ids: [], linked_evidence_ids: [] };
const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : new Date().toISOString().slice(0, 10));
const ROW2 = 'grid gap-[12px] sm:grid-cols-2';

interface Draft {
  title: string; description: string; incident_date: string; severity: string; status: string; impact: string; risk: string | null; assignee: string | null;
  tags: string; root_cause: string; corrective_actions: string; operational_impact: string;
}

const draftOf = (i: IncidentRow | null): Draft => ({
  title: i?.title ?? '', description: i?.description ?? '', incident_date: day(i?.incident_date), severity: i?.severity ?? 'medium', status: i?.status ?? 'open',
  impact: i?.financial_impact != null ? String(i.financial_impact) : '', risk: i?.risk_id ? String(i.risk_id) : null, assignee: i?.assigned_to ? String(i.assigned_to) : null,
  tags: (i?.tags ?? []).join(', '), root_cause: i?.root_cause ?? '', corrective_actions: i?.corrective_actions ?? '', operational_impact: i?.operational_impact ?? '',
});

export function IncidentForm({ incident, saving, onSubmit, onClose }: {
  incident: IncidentRow | null;
  saving: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const isNew = incident === null;
  const [opened] = useState(() => draftOf(incident));
  const [draft, setDraft] = useState<Draft>(opened);
  const [picked, setPicked] = useState<Partial<LinkSet>>({});
  const [tried, setTried] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const people = useTenantUsers();
  const risks = useLeanRisks();
  const assets = useQuery({ queryKey: ['erm-incident-pick-assets'], queryFn: async () => (await assetsApi.getAll({ limit: 500 })).data as Array<{ id: number; name: string; asset_type?: string }> });
  const vulns = useQuery({
    queryKey: ['erm-incident-pick-vulns'],
    queryFn: async () => { const r = await vulnManagementApi.vulnerabilities.getAll({ include_closed: true }); return (Array.isArray(r.data) ? r.data : []) as Array<{ id: number; title?: string; cve_id?: string; severity?: string }>; },
  });
  const evidence = useQuery({
    queryKey: ['erm-incident-pick-evidence'],
    queryFn: async () => { const r = await evidenceApi.getAll(); return (Array.isArray(r.data) ? r.data : []) as unknown as Array<{ id: number; title?: string; evidence_type?: string }>; },
  });
  const links = useQuery({
    queryKey: ['erm-incident-links', incident?.id],
    queryFn: async () => (await ermApi.incidents.getLinks(incident!.id)).data,
    enabled: !isNew,
    retry: 1,
    staleTime: 0,
  });
  const linksState: LinksState = isNew ? 'not_needed' : links.data ? 'ready' : links.isError ? 'failed' : 'loading';
  const stored: LinkSet = useMemo(() => {
    if (!links.data) return EMPTY_LINKS;
    const riskIds = links.data.risks.map((x) => x.risk_id);
    return {
      linked_asset_ids: links.data.assets.map((a) => a.asset_id),
      linked_vulnerability_ids: links.data.vulnerabilities.map((v) => v.vulnerability_id),
      linked_risk_ids: riskIds.length ? riskIds : incident?.risk_id ? [incident.risk_id] : [],
      linked_evidence_ids: links.data.evidence.map((e) => e.evidence_id),
    };
  }, [links.data, incident]);
  const current: LinkSet = { ...stored, ...picked } as LinkSet;

  const suggest = useReportedMutation({
    mutationFn: async () => (await ermApi.incidents.aiSuggestManual({ title: draft.title, description: draft.description || undefined, severity: draft.severity, risk_id: draft.risk ? Number(draft.risk) : undefined })).data,
    success: 'AI suggestions added', failure: "Couldn't get AI suggestions", toast: 'errors',
    onSuccess: (r) => {
      const s = r.suggestion;
      setDraft((d) => ({
        ...d, severity: (INCIDENT_SEVERITIES as readonly string[]).includes(s.suggested_severity) ? s.suggested_severity : d.severity,
        root_cause: d.root_cause || s.root_cause || '', corrective_actions: d.corrective_actions || s.corrective_actions || '', operational_impact: d.operational_impact || s.operational_impact || '',
      }));
      setNote(s.rationale || 'The AI filled the empty assessment fields. Check them before saving.');
    },
  });

  const dirty = (Object.keys(opened) as Array<keyof Draft>).some((k) => opened[k] !== draft[k]) || Object.keys(picked).length > 0;
  const titleError = tried && !draft.title.trim() ? 'Enter a title.' : undefined;
  const dateError = tried && !draft.incident_date ? 'Choose the date it happened.' : undefined;
  const impactError = draft.impact !== '' && !Number.isFinite(Number(draft.impact)) ? 'Enter a number.' : undefined;
  const canSave = mayBeSaved(isNew, linksState);

  const submit = () => {
    setTried(true);
    if (!draft.title.trim() || !draft.incident_date || impactError || !canSave) return;
    const set4 = linkPayload(isNew, linksState, current);
    const primary = draft.risk ? Number(draft.risk) : undefined;
    const riskLinks = set4.linked_risk_ids ? Array.from(new Set(primary ? set4.linked_risk_ids.concat(primary) : set4.linked_risk_ids)) : undefined;
    onSubmit({
      title: draft.title.trim(), description: draft.description, incident_date: draft.incident_date, severity: draft.severity,
      financial_impact: draft.impact === '' ? (isNew ? undefined : null) : Number(draft.impact),
      assigned_to: draft.assignee ? Number(draft.assignee) : (isNew ? undefined : null),
      tags: parseTags(draft.tags), root_cause: draft.root_cause, corrective_actions: draft.corrective_actions, operational_impact: draft.operational_impact,
      risk_id: primary ?? riskLinks?.[0],
      ...set4,
      ...(riskLinks ? { linked_risk_ids: riskLinks } : {}),
      ...(isNew ? {} : { status: draft.status }),
    });
  };

  const optionsFor = <T,>(q: { data?: T[]; isError: boolean }, map: (x: T) => { value: string; label: string; description?: string }) => (q.data ?? []).map(map);
  const failedList = (name: string, retry: () => void) => <ErrorState compact title={`Couldn't load the ${name}`} onRetry={retry} />;

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={dirty}
      title={isNew ? 'Report an incident' : 'Edit incident'}
      subtitle={isNew ? undefined : incident!.title}
      footer={(
        <div className="flex items-center justify-end gap-[8px]">
          {!canSave && linksState === 'loading' && <span role="status" className="mr-auto text-ds-label text-ds-fg-muted">Reading its links…</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!canSave} onClick={submit}>{isNew ? 'Report incident' : 'Save changes'}</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <div className="flex flex-wrap items-center gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px]">
          <p className="min-w-0 flex-1 text-ds-body text-ds-fg-body">Let the AI fill the empty assessment fields from the title.</p>
          <Button leftIcon={<Sparkles aria-hidden />} loading={suggest.isPending} disabled={!draft.title.trim()} onClick={() => suggest.mutate()}>AI suggest</Button>
        </div>
        {note && <Notice tone="info">{note}</Notice>}

        <FormField label="Title" required error={titleError}>
          <TextInput value={draft.title} maxLength={255} onChange={(e) => set('title', e.target.value)} />
        </FormField>
        <div className={ROW2}>
          <FormField label="Incident date" required error={dateError}>
            <TextInput type="date" value={draft.incident_date} onChange={(e) => set('incident_date', e.target.value)} />
          </FormField>
          <FormField label="Severity">
            <Select value={draft.severity} onChange={(e) => set('severity', e.target.value)}>
              {optionsOf(severity, INCIDENT_SEVERITIES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FormField>
        </div>
        {!isNew && (
          <FormField label="Status">
            <Select value={draft.status} onChange={(e) => set('status', e.target.value)}>
              {optionsOf(incidentStatus, INCIDENT_STATUSES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              {!(INCIDENT_STATUSES as readonly string[]).includes(draft.status) && <option value={draft.status}>{incidentStatus.label(draft.status)}</option>}
            </Select>
          </FormField>
        )}
        <div className={ROW2}>
          <FormField label="Main risk" optional>
            <Combobox label="Main risk" options={riskOptions(risks.data?.items)} value={draft.risk} onChange={(v) => set('risk', v)} clearable placeholder={risks.isError ? 'The risks could not be loaded' : 'Not linked to a risk'} disabled={risks.isError} />
          </FormField>
          <FormField label="Assigned to" optional>
            <Combobox label="Assigned to" options={personOptions(people.data)} value={draft.assignee} onChange={(v) => set('assignee', v)} clearable placeholder={people.isError ? 'The people could not be loaded' : 'Unassigned'} disabled={people.isError} />
          </FormField>
        </div>
        <div className={ROW2}>
          <FormField label="Financial impact" optional error={impactError} info="The amount lost, in your reporting currency.">
            <TextInput type="number" inputMode="decimal" step="any" value={draft.impact} onChange={(e) => set('impact', e.target.value)} />
          </FormField>
          <FormField label="Tags" optional hint="Separate with commas.">
            <TextInput value={draft.tags} onChange={(e) => set('tags', e.target.value)} placeholder="availability, payments" />
          </FormField>
        </div>
        <FormField label="Description" optional>
          <Textarea rows={3} value={draft.description} onChange={(e) => set('description', e.target.value)} />
        </FormField>

        <fieldset className="m-0 flex min-w-0 flex-col gap-[12px] rounded-ds-card border border-ds-border p-[12px]">
          <legend className="px-[4px] text-ds-body font-[600] text-ds-fg">Linked records</legend>
          {linksState === 'failed' && <ErrorState compact title="Couldn't read the links of this incident" message={`${errorMessage(links.error)} It cannot be saved until they are read, so nothing is lost.`} onRetry={() => { void links.refetch(); }} />}
          {linksState === 'loading' && <p role="status" className="text-ds-label text-ds-fg-muted">Reading the links of this incident…</p>}
          <FormField label="Related risks" optional>
            <MultiSelect label="Related risks" options={riskOptions(risks.data?.items)} value={current.linked_risk_ids.map(String)} onChange={(v) => setPicked((p) => ({ ...p, linked_risk_ids: v.map(Number) }))} placeholder="Link risks" disabled={linksState !== 'ready' && linksState !== 'not_needed'} />
          </FormField>
          <FormField label="Related assets" optional>
            {assets.isError ? failedList('assets', () => { void assets.refetch(); }) : (
              <MultiSelect label="Related assets" options={optionsFor(assets, (a) => ({ value: String(a.id), label: a.name, description: a.asset_type }))} value={current.linked_asset_ids.map(String)} onChange={(v) => setPicked((p) => ({ ...p, linked_asset_ids: v.map(Number) }))} placeholder="Link assets" disabled={linksState !== 'ready' && linksState !== 'not_needed'} />
            )}
          </FormField>
          <FormField label="Related vulnerabilities" optional>
            {vulns.isError ? failedList('vulnerabilities', () => { void vulns.refetch(); }) : (
              <MultiSelect label="Related vulnerabilities" options={optionsFor(vulns, (v) => ({ value: String(v.id), label: v.title || v.cve_id || `Vulnerability ${v.id}`, description: v.severity || v.cve_id }))} value={current.linked_vulnerability_ids.map(String)} onChange={(v) => setPicked((p) => ({ ...p, linked_vulnerability_ids: v.map(Number) }))} placeholder="Link vulnerabilities" disabled={linksState !== 'ready' && linksState !== 'not_needed'} />
            )}
          </FormField>
          <FormField label="Related evidence" optional>
            {evidence.isError ? failedList('evidence', () => { void evidence.refetch(); }) : (
              <MultiSelect label="Related evidence" options={optionsFor(evidence, (e) => ({ value: String(e.id), label: e.title || `Evidence ${e.id}`, description: e.evidence_type }))} value={current.linked_evidence_ids.map(String)} onChange={(v) => setPicked((p) => ({ ...p, linked_evidence_ids: v.map(Number) }))} placeholder="Link evidence" disabled={linksState !== 'ready' && linksState !== 'not_needed'} />
            )}
          </FormField>
        </fieldset>

        <FormField label="Root cause" optional><Textarea rows={3} value={draft.root_cause} onChange={(e) => set('root_cause', e.target.value)} /></FormField>
        <FormField label="Corrective actions" optional><Textarea rows={3} value={draft.corrective_actions} onChange={(e) => set('corrective_actions', e.target.value)} /></FormField>
        <FormField label="Operational impact" optional><Textarea rows={3} value={draft.operational_impact} onChange={(e) => set('operational_impact', e.target.value)} /></FormField>
      </div>
    </RightSlidePanel>
  );
}

export { LINK_KEYS };
