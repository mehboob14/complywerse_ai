'use client';

// An administrator's shortcut past the owner's draft: the library's words are filled in, the person adds what only they know (who
// owns it, how likely and how severe it is here) and the register gets a Draft risk that remembers its source; it joins the register
// when someone else in the risk team accepts it (Proposals tab). Everyone else proposes the risk to its owner (ProposeDialog).
// It follows the register's own form: the organisation's category list, field names and hidden fields, and its Custom fields tab
// (required ones are enforced). The risk is also linked to the controls of the objective the person keeps ticked.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { teamsApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import {
  CustomFieldsTab, CustomFieldsTabBar, builtinLabel, errorText, listOptions, showBuiltin, tabOf, useModuleSettings, valuesToSave,
  type CustomValues,
} from '@/components/settings/CustomFields';
import { riskLibraryApi, type AddedRisk } from '../_lib/api';
import {
  BAND_LABEL, CATEGORIES, IMPACT, LIKELIHOOD, bandOf, inherentScore, linkable, problem, requestBody, startForm, toggleControl,
  type AddForm, type Band, type LibraryRisk,
} from '../_lib/model';

export const FIELD = 'mt-1 h-10 w-full rounded-lg border border-[#c9d1d9] bg-[#ffffff] px-3 text-[14px] text-[#1f2933] focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/30';
export const AREA = 'mt-1 w-full rounded-lg border border-[#c9d1d9] bg-[#ffffff] px-3 py-2 text-[14px] leading-5 text-[#1f2933] focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/30';
export const LABEL = 'block text-[13px] font-medium text-[#26323d]';
export const BTN = 'inline-flex h-9 items-center justify-center rounded-lg border border-[#c9d1d9] bg-[#ffffff] px-4 text-[14px] font-medium text-[#26323d] hover:bg-[#f4f6f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
export const BTN_PRIMARY = 'inline-flex h-9 items-center justify-center rounded-lg bg-[#0f766e] px-4 text-[14px] font-medium text-[#ffffff] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] focus-visible:ring-offset-2';

const BAND_STYLE: Record<Band, string> = {
  critical: 'bg-[#fde8e8] text-[#9b1c1c]', high: 'bg-[#ffedd5] text-[#9a3412]', medium: 'bg-[#fef3c7] text-[#92400e]', low: 'bg-[#dcfce7] text-[#166534]',
};

export function Score({ likelihood, impact }: { likelihood: string; impact: string }) {
  const score = inherentScore({ inherent_likelihood: likelihood, inherent_impact: impact });
  const band = bandOf(score);
  if (!score || !band) return <span className="text-[13px] text-[#586472]">Score shows here</span>;
  return <span className={`inline-flex h-7 items-center rounded-full px-2.5 text-[13px] font-medium ${BAND_STYLE[band]}`}>Score {score} · {BAND_LABEL[band]}</span>;
}

export default function AddToRegisterDialog({ risk, framework, onClose, onAdded }: {
  risk: LibraryRisk | null;
  /** This organisation's installed copy of the framework the risk comes from (null: not installed, nothing to link). */
  framework: { id: number; name: string } | null;
  onClose: () => void;
  onAdded: (added: AddedRisk) => void;
}) {
  const [form, setForm] = useState<AddForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'details' | 'custom'>('details');
  const [custom, setCustom] = useState<CustomValues>({});
  useEffect(() => { setForm(risk ? startForm(risk) : null); setError(null); setTab('details'); setCustom({}); }, [risk?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const { data: settings } = useModuleSettings('risks');
  const people = useQuery({ queryKey: ['risk-library-people'], queryFn: riskLibraryApi.people, staleTime: 60_000, enabled: !!risk });
  const teams = useQuery({
    queryKey: ['risk-library-teams'], enabled: !!risk, staleTime: 60_000,
    queryFn: async () => { try { return (await teamsApi.list(false)).data || []; } catch { return []; } },
  });
  const already = risk?.in_register || null;
  const categories = listOptions(settings, 'category', form?.category, CATEGORIES);

  const add = useMutation({
    mutationFn: (f: AddForm) => riskLibraryApi.add(risk!.id, requestBody(f, !!already || !!risk!.proposals?.length, valuesToSave(settings, custom))),
    onSuccess: (added) => { onAdded(added); },
    onError: (e) => setError(errorText(e, 'Could not add the risk.')),
  });

  const blocked = useMemo(() => (form ? problem(form) : null), [form]);
  const set = (change: Partial<AddForm>) => { setError(null); setForm((f) => (f ? { ...f, ...change } : f)); };
  if (!risk || !form) return null;

  const submit = (e: React.FormEvent) => { e.preventDefault(); if (!blocked && !add.isPending) add.mutate(form); };
  const all = risk.controls.map((c) => c.control_id);
  const canLink = linkable(risk);

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="lg"
      title="Add to risk register"
      subtitle={`${risk.objective_id} · ${risk.objective_title}`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span role="status" className="min-w-0 truncate text-[13px] text-[#9b1c1c]">{error || ''}</span>
          <div className="flex shrink-0 gap-2">
            <button type="button" className={BTN} onClick={onClose}>Cancel</button>
            <button type="submit" form="risk-library-add" className={BTN_PRIMARY} disabled={!!blocked || add.isPending} title={blocked || undefined}>
              {add.isPending ? 'Adding…' : 'Add as draft'}
            </button>
          </div>
        </div>
      }
    >
      {/* A required field left empty on the other tab: go to it. */}
      <form id="risk-library-add" onSubmit={submit} onInvalidCapture={(e) => setTab(tabOf(e.target))} className="space-y-4 px-1 py-1">
        <CustomFieldsTabBar tab={tab} onTab={setTab} settings={settings} />
        <div data-tab="details" className={tab === 'details' ? 'space-y-4' : 'hidden'}>
          <div className="rounded-lg bg-[#e6f6f3] px-3 py-2">
            <p className="text-[13px] leading-5 text-[#115e59]">
              <span className="font-medium">{risk.family_id} {risk.family_name}.</span> {risk.objective}
            </p>
          </div>
          <p className="text-[13px] leading-5 text-[#586472]">
            It starts as a draft. It joins the register when someone else in the risk team accepts it on the Proposals tab.
          </p>

          {already && (
            <div className="flex items-start gap-2 rounded-lg bg-[#fef3c7] px-3 py-2">
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[#92400e]" />
              <p className="text-[13px] leading-5 text-[#92400e]">
                This risk is already in your register (<Link href={`/erm/risks/${already.risk_id}`} className="font-medium underline">risk #{already.risk_id}</Link>).
                Adding it again makes a second entry.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="rl-title" className={LABEL}>{builtinLabel(settings, 'title', 'Title')} <span aria-hidden className="text-[#9b1c1c]">*</span></label>
            <input id="rl-title" className={FIELD} value={form.title} maxLength={255} onChange={(e) => set({ title: e.target.value })} required />
          </div>
          {showBuiltin(settings, 'description') && (
            <div>
              <label htmlFor="rl-description" className={LABEL}>{builtinLabel(settings, 'description', 'Description')}</label>
              <textarea id="rl-description" rows={3} className={AREA} value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {showBuiltin(settings, 'category') && (
              <div>
                <label htmlFor="rl-category" className={LABEL}>{builtinLabel(settings, 'category', 'Category')}</label>
                <select id="rl-category" className={FIELD} value={form.category} onChange={(e) => set({ category: e.target.value })}>
                  {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="rl-owner" className={LABEL}>Risk owner <span aria-hidden className="text-[#9b1c1c]">*</span></label>
              <select id="rl-owner" className={FIELD} value={form.owner_id} onChange={(e) => set({ owner_id: e.target.value })} required>
                <option value="">Choose a person</option>
                {(people.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {showBuiltin(settings, 'owner') && (
              <div>
                <label htmlFor="rl-business-owner" className={LABEL}>{builtinLabel(settings, 'owner', 'Business owner')}</label>
                <select id="rl-business-owner" className={FIELD} value={form.business_owner_id} onChange={(e) => set({ business_owner_id: e.target.value })}>
                  <option value="">Not set</option>
                  {(people.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            {showBuiltin(settings, 'team') && (
              <div>
                <label htmlFor="rl-team" className={LABEL}>{builtinLabel(settings, 'team', 'Team / department')}</label>
                <select id="rl-team" className={FIELD} value={form.team_id} onChange={(e) => set({ team_id: e.target.value })}>
                  <option value="">Not set</option>
                  {(teams.data || []).map((t: { id: number; name: string }) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <fieldset className="rounded-lg border border-[#d8dee4] px-3 pb-3 pt-2">
            <legend className="px-1 text-[13px] font-medium text-[#26323d]">Rating (1 to 5)</legend>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div>
                <label htmlFor="rl-il" className={LABEL}>{builtinLabel(settings, 'inherent_likelihood', 'Likelihood')} <span aria-hidden className="text-[#9b1c1c]">*</span></label>
                <select id="rl-il" className={FIELD} value={form.inherent_likelihood} onChange={(e) => set({ inherent_likelihood: e.target.value })} required>
                  <option value="">Choose</option>
                  {LIKELIHOOD.map((l, i) => <option key={l} value={i + 1}>{i + 1} · {l}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="rl-ii" className={LABEL}>{builtinLabel(settings, 'inherent_impact', 'Impact')} <span aria-hidden className="text-[#9b1c1c]">*</span></label>
                <select id="rl-ii" className={FIELD} value={form.inherent_impact} onChange={(e) => set({ inherent_impact: e.target.value })} required>
                  <option value="">Choose</option>
                  {IMPACT.map((l, i) => <option key={l} value={i + 1}>{i + 1} · {l}</option>)}
                </select>
              </div>
              <div className="flex h-10 items-center"><Score likelihood={form.inherent_likelihood} impact={form.inherent_impact} /></div>
              {showBuiltin(settings, 'residual_likelihood') && showBuiltin(settings, 'residual_impact') && (
                <>
                  <div>
                    <label htmlFor="rl-rl" className={LABEL}>{builtinLabel(settings, 'residual_likelihood', 'Residual likelihood')}</label>
                    <select id="rl-rl" className={FIELD} value={form.residual_likelihood} onChange={(e) => set({ residual_likelihood: e.target.value })}>
                      <option value="">Not rated</option>
                      {LIKELIHOOD.map((l, i) => <option key={l} value={i + 1}>{i + 1} · {l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="rl-ri" className={LABEL}>{builtinLabel(settings, 'residual_impact', 'Residual impact')}</label>
                    <select id="rl-ri" className={FIELD} value={form.residual_impact} onChange={(e) => set({ residual_impact: e.target.value })}>
                      <option value="">Not rated</option>
                      {IMPACT.map((l, i) => <option key={l} value={i + 1}>{i + 1} · {l}</option>)}
                    </select>
                  </div>
                  <div className="flex h-10 items-center"><Score likelihood={form.residual_likelihood} impact={form.residual_impact} /></div>
                </>
              )}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            {showBuiltin(settings, 'treatment_plan') && (
              <div>
                <label htmlFor="rl-plan" className={LABEL}>{builtinLabel(settings, 'treatment_plan', 'Treatment plan')}</label>
                <textarea id="rl-plan" rows={2} className={AREA} value={form.treatment_plan} onChange={(e) => set({ treatment_plan: e.target.value })} />
              </div>
            )}
            <div>
              <label htmlFor="rl-review" className={LABEL}>Review date</label>
              <input id="rl-review" type="date" className={FIELD} value={form.review_date} onChange={(e) => set({ review_date: e.target.value })} />
            </div>
          </div>

          <fieldset className="rounded-lg border border-[#d8dee4] px-3 pb-3 pt-2">
            <legend className="px-1 text-[13px] font-medium text-[#26323d]">Controls to link</legend>
            {!framework ? (
              <p className="text-[13px] leading-5 text-[#586472]">
                This framework is not installed in your organisation, so no controls can be linked. The risk is still added, and you can link controls later.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] leading-5 text-[#586472]">From {framework.name}. {form.controls.length} of {all.length} ticked.</p>
                  <div className="flex gap-3 text-[13px]">
                    <button type="button" className="font-medium text-[#0f766e] hover:underline" onClick={() => set({ controls: canLink })}>All</button>
                    <button type="button" className="font-medium text-[#0f766e] hover:underline" onClick={() => set({ controls: [] })}>None</button>
                  </div>
                </div>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {risk.controls.map((c) => {
                    const missing = c.installed === false;
                    return (
                      <li key={c.control_id}>
                        <label className={`flex items-start gap-2 text-[13px] leading-5 ${missing ? 'text-[#8a95a1]' : 'text-[#26323d]'}`}>
                          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#0f766e]" disabled={missing}
                            checked={form.controls.includes(c.control_id)} onChange={() => set({ controls: toggleControl(all, form.controls, c.control_id) })} />
                          <span><span className="font-medium">{c.control_id}</span> {c.title}{missing ? ' (not in your framework)' : ''}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </fieldset>
        </div>
        <div data-tab="custom" className={tab === 'custom' ? '' : 'hidden'}>
          <CustomFieldsTab moduleKey="risks" values={custom} onChange={setCustom} />
        </div>
      </form>
    </AnimatedModal>
  );
}
