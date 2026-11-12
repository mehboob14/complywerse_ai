'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import Link from 'next/link';
import {
  GitBranch,
  Shield,
  AlertTriangle,
  Target,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Zap,
  ShieldCheck,
  ShieldAlert,
  TrendingDown,
  Sparkles,
  Brain,
  Plus,
  Pencil,
  X,
  Check,
} from 'lucide-react';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { PageLoader } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import {
  IMPACT_CATEGORY_LABELS, controlTypeLabel, effectivenessLabel, effectivenessTone, gapText, hasGap, kindLabel,
  placeControls, sideFor, sourceLabel,
} from './bowtieModel';
import type { BowTieItem, LinkedControl } from './bowtieModel';

interface Suggestion { title: string; source: string }

interface BowTieData {
  risk_id: number;
  risk_title: string;
  risk_description?: string | null;
  risk_category?: string | null;
  inherent_score?: number | null;
  residual_score?: number | null;
  threats: BowTieItem[];
  consequences: BowTieItem[];
  controls: LinkedControl[];
  suggested_causes: Suggestion[];
  suggested_consequences: Suggestion[];
  impact_categories: string[];
}

type ItemDraft = { title: string; impact_category?: string | null; control_link_ids?: number[] };

export default function BowTieAnalysisPage() {
  const queryClient = useQueryClient();
  const { hasAnyPermission } = usePermissions();
  const canEdit = hasAnyPermission(['risks:risk_assessment:edit', 'erm:risks:edit']);
  const [selectedRiskId, setSelectedRiskId] = useState<number | null>(null);
  const [aiNarrative, setAiNarrative] = useState<string | null>(null);

  const narrativeMutation = useMutation({
    mutationFn: async (riskId: number) => {
      const response = await ermApi.analytics.generateBowTieNarrative(riskId);
      return response.data;
    },
    onSuccess: (data: any) => {
      setAiNarrative(data.narrative);
    },
  });

  const { data: risks } = useQuery({
    queryKey: ['erm-risks-list'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
  });

  const { data: bowTieData, isLoading: bowTieLoading } = useQuery<BowTieData>({
    queryKey: ['erm-bowtie', selectedRiskId],
    queryFn: async () => {
      const response = await ermApi.analytics.getBowTie(selectedRiskId!);
      return response.data;
    },
    enabled: !!selectedRiskId,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['erm-bowtie', selectedRiskId] });
  const addItem = useMutation({
    mutationFn: (data: { side: 'cause' | 'consequence'; title: string; impact_category?: string | null; source?: string }) =>
      ermApi.analytics.addBowTieItem(selectedRiskId!, data),
    onSuccess: refresh,
  });
  const updateItem = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ItemDraft }) => ermApi.analytics.updateBowTieItem(selectedRiskId!, id, data),
    onSuccess: refresh,
  });
  const deleteItem = useMutation({
    mutationFn: (id: number) => ermApi.analytics.deleteBowTieItem(selectedRiskId!, id),
    onSuccess: refresh,
  });
  const raiseAction = useMutation({
    mutationFn: (id: number) => ermApi.analytics.raiseBowTieGapAction(selectedRiskId!, id),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['mitigation-actions'] });
    },
  });

  const scoreReduction = bowTieData
    ? (bowTieData.inherent_score ?? 0) - (bowTieData.residual_score ?? 0)
    : 0;

  const scoreReductionPct = bowTieData && (bowTieData.inherent_score ?? 0) > 0
    ? Math.round((scoreReduction / (bowTieData.inherent_score as number)) * 100)
    : 0;

  const controls = bowTieData?.controls || [];
  const sides = placeControls(controls);
  const itemProps = {
    controls,
    canEdit,
    onAdd: (side: 'cause' | 'consequence', title: string, impact?: string | null, source?: string) =>
      addItem.mutate({ side, title, impact_category: impact, source }),
    onSave: (id: number, data: ItemDraft) => updateItem.mutate({ id, data }),
    onDelete: (id: number) => deleteItem.mutate(id),
    onRaise: (id: number) => raiseAction.mutate(id),
    busy: addItem.isPending || updateItem.isPending || deleteItem.isPending,
    raisingId: raiseAction.isPending ? raiseAction.variables : null,
  };

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link
            href="/erm"
            className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900 flex items-center gap-2.5">
              <GitBranch className="h-6 w-6 text-primary-600" strokeWidth={1.75} />
              Bow-Tie Risk Analysis
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Causes, the controls that stop them, the controls that limit the damage, and the consequences
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3.5">
        <label className="block text-sm font-medium text-slate-600 mb-2">Select a Risk to Analyze</label>
        <MultiSelectDropdown
          title="Choose a risk"
          items={(risks || []).map((risk: any) => ({
            value: String(risk.id),
            label: `${risk.title}${risk.risk_category ? ` (${risk.risk_category})` : ''} — Score: ${risk.residual_score ?? 'N/A'}`,
          }))}
          selectedValues={selectedRiskId ? [String(selectedRiskId)] : []}
          onApply={(values) => {
            setSelectedRiskId(values[0] ? Number(values[0]) : null);
            setAiNarrative(null);
          }}
          multiSelect={false}
          forceSearch
          triggerVariant="input"
        />
      </div>

      {!selectedRiskId && (
        <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-slate-200 bg-white">
          <GitBranch className="h-16 w-16 text-slate-400" />
          <h3 className="mt-4 text-lg font-medium text-slate-900">No Risk Selected</h3>
          <p className="mt-2 text-slate-600 text-center max-w-md">
            Select a risk from the dropdown above to view its bow-tie analysis showing causes,
            controls, and consequences.
          </p>
        </div>
      )}

      {selectedRiskId && bowTieLoading && (
        <PageLoader className="h-64" label="Loading bow-tie analysis..." />
      )}

      {selectedRiskId && bowTieData && !bowTieLoading && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 overflow-x-auto">
            {controls.length === 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-sm text-slate-600">No controls linked to this risk yet.</p>
                <Link href={`/erm/risks/${bowTieData.risk_id}`} className="text-xs font-medium text-primary-700 hover:underline">
                  Link controls on the risk record
                </Link>
              </div>
            )}
            <div className="flex items-stretch justify-center gap-2 min-w-[980px]">
              <ItemColumn
                side="cause"
                heading="Causes"
                icon={<Zap className="h-4 w-4" />}
                items={bowTieData.threats || []}
                suggestions={bowTieData.suggested_causes || []}
                {...itemProps}
              />

              <Arrows />

              <ControlColumn heading="Preventive" icon={<Shield className="h-4 w-4" strokeWidth={1.75} />}
                             controls={sides.preventive} empty="No preventive controls" />

              <div className="flex flex-col justify-center flex-shrink-0">
                <div className="h-full w-1 bg-primary-500 rounded-full mx-2" />
              </div>

              <div className="flex flex-col justify-center flex-shrink-0 w-[200px]">
                <div className="rounded-xl border-2 border-amber-500 bg-amber-50 p-4 text-center shadow-sm">
                  <AlertTriangle className="h-7 w-7 text-amber-600 mx-auto mb-2" />
                  <h3 className="text-base font-semibold text-slate-900">{bowTieData.risk_title}</h3>
                  {bowTieData.risk_category && (
                    <span className="inline-block mt-1 rounded-full border border-amber-200 bg-white px-3 py-0.5 text-xs text-amber-700">
                      {bowTieData.risk_category}
                    </span>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-white/80 p-1.5">
                      <p className="text-xs text-slate-600">Before controls</p>
                      <p className="text-lg font-bold text-rose-600">{bowTieData.inherent_score ?? '—'}</p>
                    </div>
                    <div className="rounded-lg bg-white/80 p-1.5">
                      <p className="text-xs text-slate-600">After controls</p>
                      <p className="text-lg font-bold text-emerald-600">{bowTieData.residual_score ?? '—'}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-center flex-shrink-0">
                <div className="h-full w-1 bg-emerald-500 rounded-full mx-2" />
              </div>

              <ControlColumn heading="Mitigating" icon={<ShieldCheck className="h-4 w-4" />}
                             controls={sides.mitigating} empty="No mitigating controls" />

              <Arrows />

              <ItemColumn
                side="consequence"
                heading="Consequences"
                icon={<Target className="h-4 w-4" />}
                items={bowTieData.consequences || []}
                suggestions={bowTieData.suggested_consequences || []}
                impactCategories={bowTieData.impact_categories || Object.keys(IMPACT_CATEGORY_LABELS)}
                {...itemProps}
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-6 border-t border-slate-200 pt-3.5">
              <Legend tone="bg-slate-200 border-slate-400" label="Causes" />
              <Legend tone="bg-primary-200 border-primary-500" label="Preventive controls" />
              <Legend tone="bg-amber-200 border-amber-500" label="Risk event" />
              <Legend tone="bg-emerald-200 border-emerald-500" label="Mitigating controls" />
              <Legend tone="bg-slate-200 border-slate-400" label="Consequences" />
              <Legend tone="bg-rose-200 border-rose-500" label="Control gap" />
            </div>

            {sides.unclassified.length > 0 && (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <p className="text-xs text-slate-600 mb-2">
                  Linked controls with no type set (set preventive, detective or corrective on the control to place it on the bow-tie):
                </p>
                <div className="flex flex-wrap gap-2">
                  {sides.unclassified.map((ctrl) => (
                    <span key={ctrl.link_id} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                      {ctrl.code ? `${ctrl.code} · ` : ''}{ctrl.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4.5">
              <h3 className="text-base font-semibold text-slate-900 mb-3">Risk Details</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-slate-600">Description</p>
                  <p className="text-sm text-slate-900 mt-1">
                    {bowTieData.risk_description || 'No description provided'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Category</p>
                  <p className="text-sm text-slate-900 mt-1">{bowTieData.risk_category || '—'}</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4.5">
              <h3 className="text-base font-semibold text-slate-900 mb-3">Score Analysis</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-slate-100/50 p-3 text-center">
                  <ShieldAlert className="h-5 w-5 text-rose-500 mx-auto mb-1" />
                  <p className="text-xs text-slate-600">Before controls</p>
                  <p className="text-2xl font-bold text-rose-600 mt-1">{bowTieData.inherent_score ?? '—'}</p>
                </div>
                <div className="rounded-lg bg-slate-100/50 p-3 text-center">
                  <ShieldCheck className="h-5 w-5 text-emerald-500 mx-auto mb-1" />
                  <p className="text-xs text-slate-600">After controls</p>
                  <p className="text-2xl font-bold text-emerald-600 mt-1">{bowTieData.residual_score ?? '—'}</p>
                </div>
                <div className="rounded-lg bg-slate-100/50 p-3 text-center">
                  <TrendingDown className="h-5 w-5 text-primary-600 mx-auto mb-1" strokeWidth={1.75} />
                  <p className="text-xs text-slate-600">Reduction</p>
                  <p className="text-2xl font-bold text-primary-600 mt-1">{scoreReduction}</p>
                  <p className="text-xs text-slate-500">({scoreReductionPct}%)</p>
                </div>
              </div>

              <div className="mt-3.5 grid grid-cols-4 gap-2.5 text-center">
                <Count label="Causes" value={bowTieData.threats?.length ?? 0} />
                <Count label="Preventive" value={sides.preventive.length} />
                <Count label="Mitigating" value={sides.mitigating.length} />
                <Count label="Gaps" value={[...(bowTieData.threats || []), ...(bowTieData.consequences || [])]
                  .filter((i) => hasGap(i, controls)).length} />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4.5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary-600" strokeWidth={1.75} />
                AI Analysis
              </h3>
              <button
                onClick={() => selectedRiskId && narrativeMutation.mutate(selectedRiskId)}
                disabled={narrativeMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {narrativeMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate AI Narrative
                  </>
                )}
              </button>
            </div>

            {!aiNarrative && !narrativeMutation.isPending && !narrativeMutation.isError && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="rounded-full bg-primary-50 p-4 mb-4">
                  <Sparkles className="h-8 w-8 text-primary-600" strokeWidth={1.75} />
                </div>
                <p className="text-slate-600 max-w-md">
                  Click &quot;Generate AI Narrative&quot; to get a comprehensive plain-English explanation of the
                  bow-tie risk analysis, including threats, controls, consequences, and recommendations.
                </p>
              </div>
            )}

            {narrativeMutation.isError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
                <p className="text-sm text-rose-700">Failed to generate AI narrative. Please try again.</p>
              </div>
            )}

            {aiNarrative && (
              <div className="relative">
                <div className="absolute left-0 top-0 bottom-0 w-1 rounded-full bg-primary-500" />
                <div className="pl-6 prose prose-sm max-w-none">
                  {aiNarrative.split('\n').map((line, i) => {
                    if (line.startsWith('## ')) {
                      return <h2 key={i} className="text-lg font-bold text-slate-900 mt-4 mb-2">{line.replace('## ', '')}</h2>;
                    }
                    if (line.startsWith('### ')) {
                      return <h3 key={i} className="text-base font-semibold text-primary-700 mt-4 mb-2">{line.replace('### ', '')}</h3>;
                    }
                    if (line.startsWith('**') && line.endsWith('**')) {
                      return <h3 key={i} className="text-base font-semibold text-primary-700 mt-4 mb-2">{line.replace(/\*\*/g, '')}</h3>;
                    }
                    if (line.match(/^\d+\.\s/) || line.startsWith('- ')) {
                      return <p key={i} className="text-sm text-slate-700 ml-4 mb-1">{line}</p>;
                    }
                    if (line.trim() === '') {
                      return <div key={i} className="h-2" />;
                    }
                    return <p key={i} className="text-sm text-slate-700 mb-2">{line}</p>;
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Arrows() {
  return (
    <div className="flex flex-col justify-center flex-shrink-0">
      <div className="flex flex-col items-center gap-1 text-slate-400">
        <ArrowRight className="h-5 w-5" />
        <ArrowRight className="h-5 w-5" />
        <ArrowRight className="h-5 w-5" />
      </div>
    </div>
  );
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`h-3 w-3 rounded-full border ${tone}`} />
      <span className="text-xs text-slate-600">{label}</span>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-slate-600">{label}</p>
      <p className="text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ControlColumn({ heading, icon, controls, empty }: {
  heading: string; icon: React.ReactNode; controls: LinkedControl[]; empty: string;
}) {
  return (
    <div className="flex flex-col justify-center gap-2.5 w-[176px] flex-shrink-0">
      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-2">
        {icon}
        {heading}
      </h3>
      {controls.length > 0 ? controls.map((ctrl) => (
        <div key={ctrl.link_id} className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm font-medium text-slate-800">{ctrl.name}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {kindLabel(ctrl.kind)}{ctrl.code ? ` · ${ctrl.code}` : ''} · {controlTypeLabel(ctrl.control_type)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${effectivenessTone(ctrl.effectiveness)}`}>
              {effectivenessLabel(ctrl.effectiveness)}
            </span>
            {ctrl.last_tested_at && (
              <span className="text-[11px] text-slate-500">Tested {new Date(ctrl.last_tested_at).toLocaleDateString()}</span>
            )}
          </div>
        </div>
      )) : (
        <p className="text-xs text-slate-500 italic">{empty}</p>
      )}
    </div>
  );
}

interface ItemColumnProps {
  side: 'cause' | 'consequence';
  heading: string;
  icon: React.ReactNode;
  items: BowTieItem[];
  suggestions: Suggestion[];
  impactCategories?: string[];
  controls: LinkedControl[];
  canEdit: boolean;
  busy: boolean;
  raisingId: number | null | undefined;
  onAdd: (side: 'cause' | 'consequence', title: string, impact?: string | null, source?: string) => void;
  onSave: (id: number, data: ItemDraft) => void;
  onDelete: (id: number) => void;
  onRaise: (id: number) => void;
}

function ItemColumn(props: ItemColumnProps) {
  const { side, heading, icon, items, suggestions, impactCategories, canEdit, busy, onAdd } = props;
  const [title, setTitle] = useState('');
  const [impact, setImpact] = useState<string>('');
  const submit = () => {
    if (!title.trim()) return;
    onAdd(side, title.trim(), side === 'consequence' ? impact || null : null, 'manual');
    setTitle('');
  };
  return (
    <div className="flex flex-col justify-center gap-2.5 w-[220px] flex-shrink-0">
      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-2">
        {icon}
        {heading}
      </h3>
      {items.length > 0 ? items.map((item) => <ItemCard key={item.id} item={item} {...props} />) : (
        <p className="text-xs text-slate-500 italic">No {side === 'cause' ? 'causes' : 'consequences'} yet</p>
      )}
      {canEdit && (
        <div className="space-y-1.5 rounded-lg border border-dashed border-slate-300 p-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={side === 'cause' ? 'Add a cause…' : 'Add a consequence…'}
            maxLength={500}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          {side === 'consequence' && (
            <select value={impact} onChange={(e) => setImpact(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none">
              <option value="">Impact category…</option>
              {(impactCategories || []).map((c) => <option key={c} value={c}>{IMPACT_CATEGORY_LABELS[c] || c}</option>)}
            </select>
          )}
          <button type="button" onClick={submit} disabled={busy || !title.trim()}
                  className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
      )}
      {canEdit && suggestions.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-slate-500">Suggested</p>
          {suggestions.map((s) => (
            <button key={`${s.source}-${s.title}`} type="button" disabled={busy}
                    onClick={() => onAdd(side, s.title, null, s.source)}
                    title={sourceLabel(s.source)}
                    className="flex w-full items-start gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-left text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              <Plus className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span className="line-clamp-2">{s.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemCard({ item, controls, canEdit, busy, raisingId, impactCategories, onSave, onDelete, onRaise }:
  ItemColumnProps & { item: BowTieItem }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ItemDraft>({ title: item.title });
  const gap = hasGap(item, controls);
  const sideControls = placeControls(controls)[item.side === 'cause' ? 'preventive' : 'mitigating']
    .concat(controls.filter((c) => sideFor(c.control_type) === 'unclassified'));
  const startEdit = () => {
    setDraft({ title: item.title, impact_category: item.impact_category ?? null, control_link_ids: item.control_link_ids || [] });
    setEditing(true);
  };

  if (editing) {
    const picked = new Set(draft.control_link_ids || []);
    return (
      <div className="space-y-1.5 rounded-lg border border-primary-200 bg-primary-50/40 p-2">
        <input value={draft.title} maxLength={500} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
               className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none" />
        {item.side === 'consequence' && (
          <select value={draft.impact_category || ''} onChange={(e) => setDraft({ ...draft, impact_category: e.target.value || null })}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none">
            <option value="">Impact category…</option>
            {(impactCategories || Object.keys(IMPACT_CATEGORY_LABELS)).map((c) => (
              <option key={c} value={c}>{IMPACT_CATEGORY_LABELS[c] || c}</option>
            ))}
          </select>
        )}
        {sideControls.length > 0 && (
          <fieldset className="space-y-0.5">
            <legend className="text-[11px] text-slate-500">Controls on this line (none ticked: all on its side)</legend>
            {sideControls.map((c) => (
              <label key={c.link_id} className="flex items-center gap-1.5 text-[11px] text-slate-700">
                <input type="checkbox" checked={picked.has(c.link_id)} onChange={() => {
                  const next = new Set(picked);
                  if (next.has(c.link_id)) next.delete(c.link_id); else next.add(c.link_id);
                  setDraft({ ...draft, control_link_ids: Array.from(next) });
                }} />
                <span className="truncate">{c.name}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex gap-1.5">
          <button type="button" disabled={busy || !draft.title.trim()}
                  onClick={() => { onSave(item.id, { ...draft, title: draft.title.trim() }); setEditing(false); }}
                  className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            <Check className="h-3 w-3" /> Save
          </button>
          <button type="button" onClick={() => setEditing(false)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border p-3 ${gap ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-1">
        <p className={`text-sm font-medium ${gap ? 'text-rose-800' : 'text-slate-800'}`}>{item.title}</p>
        {canEdit && (
          <div className="flex flex-shrink-0 gap-0.5">
            <button type="button" onClick={startEdit} title="Edit" className="rounded p-0.5 text-slate-400 hover:text-slate-700">
              <Pencil className="h-3 w-3" />
            </button>
            <button type="button" onClick={() => onDelete(item.id)} disabled={busy} title="Remove"
                    className="rounded p-0.5 text-slate-400 hover:text-rose-600">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {item.impact_category && (
          <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
            {IMPACT_CATEGORY_LABELS[item.impact_category] || item.impact_category}
          </span>
        )}
        {item.source && item.source !== 'manual' && (
          <span className="text-[11px] text-slate-500">{sourceLabel(item.source)}</span>
        )}
      </div>
      {gap && (
        <div className="mt-1.5 space-y-1">
          <p className="text-[11px] font-medium text-rose-700">Control gap: {gapText(item)}</p>
          {item.gap_action_open ? (
            <Link href="/erm/mitigation-actions" className="text-[11px] font-medium text-rose-700 underline">Action raised</Link>
          ) : canEdit && (
            <button type="button" onClick={() => onRaise(item.id)} disabled={raisingId === item.id}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">
              {raisingId === item.id && <Loader2 className="h-3 w-3 animate-spin" />}
              Raise action for gap
            </button>
          )}
        </div>
      )}
    </div>
  );
}
