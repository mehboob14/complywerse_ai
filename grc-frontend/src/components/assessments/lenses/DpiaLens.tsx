'use client';

/**
 * DPIA / PIA: a risk assessment rather than a checklist. Screening (a Yes or No per question; one Yes normally means a full DPIA is required), the risks with their likelihood by
 * impact scores before and after treatment on one heat map, the risk register, and the assessment record's fields. The score bands are the DPIA's own (15, 10, 5). An answer is
 * saved at once into the control's remarks (a JSON body); a risk opens the workspace drawer for who it is assigned to and its files.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import { Disclosure, EmptyState, ErrorState, PersonStack, RegisterTable, SectionCard, SegmentedControl, SkeletonLines, StatusPill, useAddressState, useReportedMutation, type RegisterColumn } from '@/components/ui/ds';
import { integer } from '@/lib/addressState';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { EMPTY, formatCount } from '@/lib/format';
import type { LensProps } from '../workspace/lens';
import { workspaceApi } from '../workspace/workspaceApi';
import { Heatmap } from './Heatmap';
import { ItemPanelHost } from './ItemPanelHost';
import { LensFigures } from './LensFigures';
import { mergeItem } from './lensApi';
import type { LensItem } from './lensData';
import type { Tile } from './profiles';
import { riskBand } from '@/lib/statuses/assessmentLenses';
import { answerOfScreening, BAND_LABEL, bandOfScore, fieldOf, riskKpis, screeningVerdict, sectionOf, toRisk, withField, type Risk } from './riskModel';
import { useLensData } from './useLensData';

const SCHEMA = { item: integer(0, { min: 0 }) };

function ScorePill({ score }: { score: number }) {
  const band = bandOfScore(score);
  return band === 'none' ? <span className="text-ds-body text-ds-fg-muted">{EMPTY}</span> : <StatusPill tone={riskBand.tone(band)} label={`${score} · ${BAND_LABEL[band]}`} size="sm" />;
}

export default function DpiaLens({ assessmentId, readOnly, onChanged }: LensProps) {
  const qc = useQueryClient();
  const { query, detail, items } = useLensData(assessmentId);
  const [a, set] = useAddressState(SCHEMA);
  const [mode, setMode] = useState<'inherent' | 'residual'>('inherent');
  const [open, setOpen] = useState<Array<string | number>>([]);

  const screening = useMemo(() => items.filter((i) => sectionOf(i.remarks) === 'screening'), [items]);
  const riskItems = useMemo(() => items.filter((i) => sectionOf(i.remarks) === 'risk'), [items]);
  const risks = useMemo(() => riskItems.map(toRisk), [riskItems]);
  const record = useMemo(() => items.filter((i) => sectionOf(i.remarks) === 'assessment'), [items]);
  const verdict = screeningVerdict(items);
  const kpis = riskKpis(risks);
  const byId = useMemo(() => new Map(riskItems.map((i) => [i.id, i])), [riskItems]);

  const answer = useReportedMutation({
    mutationFn: ({ item, value }: { item: LensItem; value: 'Yes' | 'No' }) => workspaceApi.updateItem(item.id, { remarks: withField(item.remarks, 'Answer', value) }),
    failure: "Couldn't save the answer",
    toast: 'errors',
    onSuccess: (res, vars) => { mergeItem(qc, assessmentId, vars.item.id, (res ?? {}) as Record<string, unknown>); onChanged(); },
  });

  if (query.isPending) return <SkeletonLines lines={6} label="Loading the assessment" />;
  if (query.isError || !detail) return <ErrorState title="Couldn't load the assessment" message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />;
  if (items.length === 0) return <EmptyState kind="firstUse" title="Nothing in this assessment yet" description={readOnly ? 'No screening question or risk was recorded.' : 'Refresh the assessment from its workbook (Actions menu).'} />;

  const figures: Tile[] = [
    { label: 'Risks logged', value: formatCount(kpis.total) },
    { label: 'Critical and high', value: `${formatCount(kpis.critical)} / ${formatCount(kpis.high)}`, tone: kpis.critical ? 'danger' : 'default', note: 'before treatment', info: 'Critical is a score of 15 or more, high 10 to 14 (likelihood times impact).' },
    { label: 'Average before treatment', value: kpis.avgInherent.toFixed(1), unit: 'of 25', note: BAND_LABEL[bandOfScore(kpis.avgInherent)] },
    { label: 'Average after treatment', value: kpis.avgResidual.toFixed(1), unit: 'of 25', note: kpis.avgInherent > kpis.avgResidual ? `down ${(kpis.avgInherent - kpis.avgResidual).toFixed(1)}` : BAND_LABEL[bandOfScore(kpis.avgResidual)] },
  ];
  const points = risks.map((r) => (mode === 'inherent' ? { l: r.l, i: r.i, id: r.id } : { l: r.resL, i: r.resI, id: r.id })).filter((p) => p.l >= 1 && p.i >= 1);

  const columns: Array<RegisterColumn<Risk>> = [
    {
      key: 'risk', header: 'Risk', isRowHeader: true, width: 'w-[44%]',
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block text-ds-label text-ds-fg-muted">{r.id || EMPTY} · {r.category}</span>
          <span className="line-clamp-3 break-words text-ds-body text-ds-fg" title={r.text}>{r.text || EMPTY}</span>
        </span>
      ),
    },
    { key: 'before', header: 'Before', card: 'meta', cell: (r) => <ScorePill score={r.score} /> },
    { key: 'after', header: 'After', card: 'meta', cell: (r) => (r.resScore > 0 ? <ScorePill score={r.resScore} /> : <span className="text-ds-body text-ds-fg-muted">{EMPTY}</span>) },
    { key: 'owner', header: 'Owner', priority: 2, card: 'meta', cell: (r) => <span className="text-ds-body text-ds-fg-body">{r.owner || EMPTY}</span> },
    { key: 'assigned', header: 'Assigned to', priority: 2, card: 'meta', cell: (r) => { const it = byId.get(r.itemId); return <PersonStack people={(it?.assignees ?? []).map((x) => x.name)} size={24} max={2} label="Assigned to" emptyLabel="Unassigned" />; } },
    { key: 'status', header: 'Status', priority: 3, card: 'meta', cell: (r) => <span className="text-ds-body text-ds-fg-body">{r.status || EMPTY}</span> },
  ];
  const facts = (r: Risk) => [
    ['Likelihood and impact', `L${r.l} × I${r.i}${r.resScore > 0 ? ` → L${r.resL} × I${r.resI}` : ''}`], ['Data subjects', r.subjects], ['Framework', r.framework], ['Controls', r.controls], ['Target', r.target],
  ].filter(([, v]) => v);

  return (
    <div className="flex flex-col gap-[16px]">
      <LensFigures figures={figures} />

      {screening.length > 0 && (
        <SectionCard
          id="screening" title="Screening" meta={`${formatCount(verdict.answered)} of ${formatCount(verdict.total)} answered`}
          info="One or more Yes answers normally means a full DPIA is required."
          actions={
            verdict.answered === 0 ? <StatusPill tone="neutral" label="Not screened yet" />
              : verdict.required ? <StatusPill tone="danger" label={`DPIA required (${verdict.yes} yes)`} /> : <StatusPill tone="success" label="DPIA may not be required" />
          }
        >
          <ul className="flex flex-col divide-y divide-ds-border">
            {screening.map((s) => {
              const ans = answerOfScreening(s);
              const Icon = ans === 'yes' ? AlertTriangle : ans === 'no' ? CheckCircle2 : CircleDashed;
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[8px] py-[8px]">
                  <span className="flex min-w-0 flex-1 items-start gap-[8px] text-ds-body text-ds-fg">
                    <Icon aria-hidden className={`mt-[2px] h-[16px] w-[16px] shrink-0 ${ans === 'yes' ? 'text-ds-danger' : ans === 'no' ? 'text-ds-success' : 'text-ds-fg-muted'}`} strokeWidth={1.75} />
                    <span className="min-w-0 break-words">{s.description}</span>
                  </span>
                  <SegmentedControl
                    label={`Answer to: ${s.description.slice(0, 60)}`} name={`screening-${s.id}`} value={ans === '' ? 'none' : ans} disabled={readOnly || (answer.isPending && answer.variables?.item.id === s.id)}
                    options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
                    onChange={(v) => { if (v === 'yes' || v === 'no') answer.mutate({ item: s, value: v === 'yes' ? 'Yes' : 'No' }); }}
                  />
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      {risks.length > 0 ? (
        <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-[auto_minmax(0,1fr)]">
          <div className="self-start">
            <SectionCard
              id="heat-map" title="Risk heat map" meta={`${formatCount(points.length)} placed`}
              actions={<SegmentedControl label="Show" name="dpia-heat" value={mode} onChange={setMode} options={[{ value: 'inherent', label: 'Before' }, { value: 'residual', label: 'After' }]} />}
            >
              <Heatmap points={points} label={mode === 'inherent' ? 'Before treatment' : 'After treatment'} />
            </SectionCard>
          </div>
          <SectionCard id="register" title="Risk register" meta={`${formatCount(risks.length)} ${risks.length === 1 ? 'risk' : 'risks'}`}>
            <RegisterTable
              caption="Risk register" columns={columns} rows={risks} getRowId={(r) => r.itemId} onRowActivate={(r) => set({ item: r.itemId })} selectedId={a.item || null}
              expand={{ open, onChange: setOpen, label: (r) => `Details of ${r.id || 'the risk'}`, render: (r) => (
                <dl className="grid grid-cols-1 gap-x-[16px] gap-y-[8px] sm:grid-cols-2">
                  {facts(r).map(([k, v]) => <div key={k}><dt className="text-ds-label text-ds-fg-muted">{k}</dt><dd className="break-words text-ds-body text-ds-fg">{v}</dd></div>)}
                </dl>
              ) }}
              cardTitle={(r) => <span className="block min-w-0"><span className="block text-ds-label text-ds-fg-muted">{r.id || EMPTY}</span><span className="line-clamp-3 break-words text-ds-body font-[600] text-ds-fg">{r.text}</span></span>}
            />
          </SectionCard>
        </div>
      ) : (
        <EmptyState kind="firstUse" title="No risk recorded" description="The workbook lists no risk yet." />
      )}

      {record.length > 0 && (
        <Disclosure label={`Assessment record (${record.length} fields)`}>
          <ul className="flex flex-col divide-y divide-ds-border pt-[8px]">
            {record.map((r) => (
              <li key={r.id} className="py-[8px]">
                <p className="text-ds-body font-[600] text-ds-fg">{r.description}{r.sub ? <span className="ml-[8px] text-ds-label font-normal text-ds-fg-muted">{r.sub}</span> : null}</p>
                {fieldOf(r.remarks, 'Guidance') && <p className="text-ds-label text-ds-fg-muted">{fieldOf(r.remarks, 'Guidance')}</p>}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      <ItemPanelHost assessmentId={assessmentId} assessmentName={detail.name} all={items} listed={riskItems} itemId={a.item} setItem={(id) => set({ item: id })} readOnly={readOnly} onChanged={onChanged} noun="risk" />
    </div>
  );
}
