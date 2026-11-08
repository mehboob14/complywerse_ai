'use client';

// The scenario tool: pick risks, say what changes (a preset or your own likelihood and impact), run it, read the scores before and after. The server does the arithmetic
// (POST scenario-analysis); lib/erm/scenario.ts decides what is sent: a preset moves only the categories it names, a risk with no score cannot be picked, and a score that was
// not there before reads "New" (the results table used to fail to draw). Levels use the one band system and a change always carries a word (worse / better), never colour alone.
// The AI explanation can be saved for the whole team, as before.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play, Sparkles } from 'lucide-react';
import {
  Button, Checkbox, EmptyState, ErrorState, FormField, Notice, RegisterTable, SegmentedControl, Select, StatTile, StatusPill, TextInput, useReportedMutation, type RegisterColumn,
} from '@/components/ui/ds';
import AiRecommendationSaver from '@/components/ai/AiRecommendationSaver';
import { aiRecommendationsApi, ermApi } from '@/lib/api';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { scoreBand } from '@/lib/erm/band';
import { categoryLabel, categoryOptions } from '@/lib/erm/categories';
import { applyCustom, applyPreset, baseOf, bandWord, changeWords, isEligible, percentWords, type Adjusted, type Preset, type ScenarioRow, type ScoreType } from '@/lib/erm/scenario';
import { statusPill } from '@/lib/status';
import { severity } from '@/lib/statuses/monitoring';
import { useLeanRisks, type LeanRisk } from '../../_monitoring/lookups';

type Result = { results: ScenarioRow[]; summary: { total_risks_analyzed: number; total_original_score: number; total_adjusted_score: number; total_change: number; risks_increased: number; risks_decreased: number; risks_unchanged: number } };
const SCORES = [{ value: 'residual', label: 'Residual' }, { value: 'inherent', label: 'Inherent' }];
const MODES = [{ value: 'preset', label: 'A preset' }, { value: 'custom', label: 'My own numbers' }];
const SHOW = 50;
const LEVELS = [1, 2, 3, 4, 5];
const num = 'tabular-nums text-ds-body text-ds-fg-body';

export function ScenarioTool() {
  const risksQ = useLeanRisks();
  const presetsQ = useQuery({ queryKey: ['erm-scenario-presets'], queryFn: async () => (await ermApi.analytics.getScenarioPresets()).data as Preset[], retry: 1 });
  const [score, setScore] = useState<ScoreType>('residual');
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [presetId, setPresetId] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [overrides, setOverrides] = useState<Record<number, { likelihood?: number; impact?: number }>>({});
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [shown, setShown] = useState(SHOW);
  const [name, setName] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);

  const all = risksQ.data?.items ?? [];
  const open = useMemo(() => all.filter((r) => !r.closure_status && (r.status || 'open') !== 'closed'), [all]);
  const matches = useMemo(() => {
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    return open.filter((r) => (!category || (r.risk_category || r.category) === category) && terms.every((t) => r.title.toLowerCase().includes(t)));
  }, [open, search, category]);
  const eligibleMatches = matches.filter((r) => isEligible(r, score));
  const chosen = open.filter((r) => picked.has(r.id) && isEligible(r, score));
  const preset = (presetsQ.data ?? []).find((p) => p.id === presetId) ?? null;
  const planned: Adjusted[] = mode === 'preset' ? (preset ? applyPreset(preset, chosen, score) : []) : applyCustom(chosen, score, overrides);
  const scenarioName = name.trim() || (mode === 'preset' && preset ? preset.name : 'Custom scenario');
  const key = mode === 'preset' && presetId ? `preset-${presetId}` : `custom-${name.trim() || 'default'}`;

  const run = useReportedMutation({
    mutationFn: async () => (await ermApi.analytics.runScenarioAnalysis({ scenarios: planned.map((p) => ({ ...p, scenario_name: scenarioName })) }, score)).data as Result,
    success: 'Scenario run', failure: "Couldn't run the scenario", toast: 'errors', retryable: true,
    onSuccess: (r) => { setResult(r); setExplanation(null); },
  });
  const explain = useReportedMutation({
    mutationFn: async () => (await ermApi.analytics.aiExplainScenario({ results: result!.results, summary: result!.summary, scenario_type: scenarioName })).data,
    success: 'Explanation ready', failure: "Couldn't explain the scenario", toast: 'none',
    onSuccess: (d) => setExplanation(d.explanation),
  });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await aiRecommendationsApi.list({ module: 'erm_analytics_scenario', recommendation_type: 'ai_explanation', entity_type: 'scenario', entity_id: key });
        const text = ((res.data as { items?: Array<{ output?: { explanation?: string } }> })?.items ?? [])[0]?.output?.explanation;
        if (live && text) setExplanation((prev) => prev ?? String(text));
      } catch { /* nothing saved yet */ }
    })();
    return () => { live = false; };
  }, [key]);

  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const canRun = planned.length > 0 && (mode === 'custom' || !!preset);
  const columns: RegisterColumn<ScenarioRow>[] = [
    { key: 'risk', header: 'Risk', isRowHeader: true, cell: (r) => <span className="line-clamp-2 break-words font-[600] text-ds-fg" title={r.risk_title}>{r.risk_title}</span> },
    { key: 'before', header: 'Before', width: 'w-[150px]', card: 'meta', cell: (r) => <span className="flex items-center gap-[6px]"><span className={num}>{r.original_score ?? '—'}</span><StatusPill size="sm" {...statusPill(severity, scoreBand(r.original_score) ?? 'none')} label={bandWord(r.original_score)} /></span> },
    { key: 'after', header: 'After', width: 'w-[150px]', card: 'meta', cell: (r) => <span className="flex items-center gap-[6px]"><span className={num}>{r.adjusted_score}</span><StatusPill size="sm" {...statusPill(severity, scoreBand(r.adjusted_score) ?? 'none')} label={bandWord(r.adjusted_score)} /></span> },
    { key: 'change', header: 'Change', width: 'w-[130px]', card: 'meta', cell: (r) => <span className={`whitespace-nowrap font-[600] ${num}`}>{changeWords(r.score_change)}</span> },
    { key: 'pct', header: 'Percent', width: 'w-[90px]', align: 'right', priority: 2, card: 'meta', cell: (r) => <span className={num}>{percentWords(r.score_change_pct)}</span> },
  ];
  const sum = result?.summary;

  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <div className="grid gap-[16px] lg:grid-cols-2">
        <section aria-labelledby="sc-risks" className="flex min-w-0 flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
          <h2 id="sc-risks" className="!text-ds-section !text-ds-fg">1. Choose the risks</h2>
          <div className="flex flex-wrap items-end gap-[8px]">
            <SegmentedControl label="Score" name="sc-score" options={SCORES} value={score} onChange={(v) => { setScore(v as ScoreType); setResult(null); }} />
            <Select aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setShown(SHOW); }} placeholder="All categories" className="w-[180px]">
              {categoryOptions(open.map((r) => r.risk_category || r.category)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <TextInput type="search" aria-label="Search risks" placeholder="Search risks" value={search} onChange={(e) => { setSearch(e.target.value); setShown(SHOW); }} className="min-w-[140px] flex-1" />
          </div>
          {risksQ.isError && <ErrorState compact title="Couldn't load the risks" message={errorMessage(risksQ.error)} onRetry={() => { void risksQ.refetch(); }} />}
          {risksQ.isLoading && <p role="status" className="text-ds-body text-ds-fg-muted">Loading the risks…</p>}
          {risksQ.data && (
            <>
              <div className="flex flex-wrap items-center gap-[8px]">
                <span role="status" className="text-ds-body font-[600] text-ds-fg">{`${formatCount(chosen.length)} chosen`}</span>
                <Button variant="link" size="sm" onClick={() => setPicked((p) => { const n = new Set(p); eligibleMatches.forEach((r) => n.add(r.id)); return n; })}>{`Choose the ${formatCount(eligibleMatches.length)} shown`}</Button>
                <Button variant="link" size="sm" onClick={() => setPicked(new Set())}>Clear</Button>
              </div>
              <ul className="m-0 max-h-[360px] list-none overflow-auto p-0" aria-label="Risks">
                {matches.slice(0, shown).map((r) => <RiskPickRow key={r.id} r={r} score={score} on={picked.has(r.id)} onToggle={() => toggle(r.id)} />)}
                {matches.length === 0 && <li className="px-[8px] py-[8px] text-ds-body text-ds-fg-muted">No open risk matches.</li>}
              </ul>
              {matches.length > shown && <Button variant="link" size="sm" onClick={() => setShown(shown + SHOW)}>{`Show ${Math.min(SHOW, matches.length - shown)} more (${formatCount(matches.length - shown)} not shown)`}</Button>}
            </>
          )}
        </section>

        <section aria-labelledby="sc-what" className="flex min-w-0 flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
          <h2 id="sc-what" className="!text-ds-section !text-ds-fg">2. Say what changes</h2>
          <SegmentedControl label="How" name="sc-mode" options={MODES} value={mode} onChange={(v) => { setMode(v as 'preset' | 'custom'); setResult(null); }} />
          {mode === 'preset' ? (
            presetsQ.isError ? <ErrorState compact title="Couldn't load the presets" message={errorMessage(presetsQ.error)} onRetry={() => { void presetsQ.refetch(); }} /> : (
              <FormField label="Preset" hint={preset ? `${preset.description}${preset.categories_affected ? `. Moves ${preset.categories_affected.map(categoryLabel).join(' and ')} risks only.` : ''}` : undefined}>
                <Select value={presetId} onChange={(e) => { setPresetId(e.target.value); setResult(null); }} placeholder={presetsQ.isLoading ? 'Loading…' : 'Choose a preset'}>
                  {(presetsQ.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </FormField>
            )
          ) : chosen.length === 0 ? (
            <p className="text-ds-body text-ds-fg-muted">Choose risks first, then set their new likelihood and impact here.</p>
          ) : (
            <ul className="m-0 flex max-h-[300px] list-none flex-col gap-[6px] overflow-auto p-0" aria-label="New likelihood and impact">
              {chosen.slice(0, 100).map((r) => {
                const base = baseOf(r, score)!;
                const o = overrides[r.id] ?? {};
                return (
                  <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_72px_72px] items-center gap-[8px]">
                    <span className="line-clamp-2 break-words text-ds-body text-ds-fg-body" title={r.title}>{r.title}</span>
                    <Select aria-label={`Likelihood of ${r.title}`} value={String(o.likelihood ?? base.likelihood)} onChange={(e) => setOverrides((x) => ({ ...x, [r.id]: { ...x[r.id], likelihood: Number(e.target.value) } }))}>{LEVELS.map((n) => <option key={n} value={n}>{`L ${n}`}</option>)}</Select>
                    <Select aria-label={`Impact of ${r.title}`} value={String(o.impact ?? base.impact)} onChange={(e) => setOverrides((x) => ({ ...x, [r.id]: { ...x[r.id], impact: Number(e.target.value) } }))}>{LEVELS.map((n) => <option key={n} value={n}>{`I ${n}`}</option>)}</Select>
                  </li>
                );
              })}
            </ul>
          )}
          <FormField label="Name" optional hint="Names the scenario in the results and in the saved explanation."><TextInput value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></FormField>
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button variant="primary" leftIcon={<Play aria-hidden />} loading={run.isPending} disabled={!canRun} onClick={() => run.mutate()}>Run the scenario</Button>
            <span className="text-ds-label text-ds-fg-muted">{canRun ? `${formatCount(planned.length)} ${planned.length === 1 ? 'risk' : 'risks'} will be tested` : 'Choose risks and a preset (or your own numbers) first.'}</span>
          </div>
        </section>
      </div>

      {result && sum && (
        <section aria-labelledby="sc-results" className="flex min-w-0 flex-col gap-[12px]">
          <h2 id="sc-results" className="!text-ds-section !text-ds-fg">{`Results: ${scenarioName}`}</h2>
          <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
            <StatTile label="Risks tested" value={formatCount(sum.total_risks_analyzed)} />
            <StatTile label="Total score" value={`${sum.total_original_score} to ${sum.total_adjusted_score}`} note={changeWords(sum.total_change)} tone={sum.total_change > 0 ? 'danger' : sum.total_change < 0 ? 'success' : 'default'} />
            <StatTile label="Worse" value={formatCount(sum.risks_increased)} note="score goes up" />
            <StatTile label="Better or the same" value={formatCount(sum.risks_decreased + sum.risks_unchanged)} note={`${formatCount(sum.risks_decreased)} better, ${formatCount(sum.risks_unchanged)} the same`} />
          </div>
          <RegisterTable caption="Scores before and after" columns={columns} rows={result.results} getRowId={(r) => r.risk_id} cardTitle={(r) => <span className="font-[600] text-ds-fg">{r.risk_title}</span>}
            empty={<EmptyState bare kind="noMatches" title="No result" />} />
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button leftIcon={<Sparkles aria-hidden />} loading={explain.isPending} onClick={() => explain.mutate()}>Explain with AI</Button>
          </div>
          {explain.isError && <ErrorState compact title="The AI could not explain this scenario right now" message="Try again in a moment." />}
          {explanation && (
            <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
              <p className="mb-[4px] text-ds-body font-[600] text-ds-fg">AI explanation</p>
              <p className="whitespace-pre-wrap text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{explanation}</p>
              <div className="mt-[12px]"><AiRecommendationSaver module="erm_analytics_scenario" recommendationType="ai_explanation" entityType="scenario" entityId={key} title={`Scenario explanation · ${scenarioName}`} output={{ explanation }} /></div>
            </div>
          )}
        </section>
      )}
      {!result && chosen.length === 0 && risksQ.data && <Notice tone="info">Pick a few risks, choose what changes, and run the scenario to see the scores before and after.</Notice>}
    </div>
  );
}

function RiskPickRow({ r, score, on, onToggle }: { r: LeanRisk; score: ScoreType; on: boolean; onToggle: () => void }) {
  const ok = isEligible(r, score);
  const s = score === 'inherent' ? r.inherent_score : r.residual_score;
  return (
    <li>
      <label className={`flex min-h-ds-control items-center gap-[8px] rounded-ds-control px-[8px] ${ok ? 'cursor-pointer hover:bg-ds-surface-hover' : 'cursor-not-allowed text-ds-fg-muted'}`}>
        <Checkbox aria-label={r.title} checked={on && ok} disabled={!ok} onChange={onToggle} />
        <span className="min-w-0 flex-1 text-ds-body [overflow-wrap:anywhere]">{r.title}</span>
        <span className="shrink-0 text-ds-label text-ds-fg-muted">{ok ? `${categoryLabel(r.risk_category || r.category)} · ${s ?? '—'}` : 'Not scored'}</span>
      </label>
    </li>
  );
}
