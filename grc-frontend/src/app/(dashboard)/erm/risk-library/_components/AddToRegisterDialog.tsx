'use client';

// The pop-up that moves a library risk into the risk register: the library's words are filled in, the person adds what only they
// know (who owns it, how likely and how severe it is here) and the register gets a normal risk that remembers its source.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { teamsApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { errorText } from '@/components/settings/CustomFields';
import { riskLibraryApi, type AddedRisk } from '../_lib/api';
import {
  BAND_LABEL, CATEGORIES, IMPACT, LIKELIHOOD, bandOf, inherentScore, problem, requestBody, startForm, type AddForm, type Band, type LibraryRisk,
} from '../_lib/model';

const FIELD = 'mt-1 h-10 w-full rounded-lg border border-[#c9d1d9] bg-[#ffffff] px-3 text-[14px] text-[#1f2933] focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/30';
const AREA = 'mt-1 w-full rounded-lg border border-[#c9d1d9] bg-[#ffffff] px-3 py-2 text-[14px] leading-5 text-[#1f2933] focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/30';
const LABEL = 'block text-[13px] font-medium text-[#26323d]';
const BTN = 'inline-flex h-9 items-center justify-center rounded-lg border border-[#c9d1d9] bg-[#ffffff] px-4 text-[14px] font-medium text-[#26323d] hover:bg-[#f4f6f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
const BTN_PRIMARY = 'inline-flex h-9 items-center justify-center rounded-lg bg-[#0f766e] px-4 text-[14px] font-medium text-[#ffffff] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] focus-visible:ring-offset-2';

const BAND_STYLE: Record<Band, string> = {
  critical: 'bg-[#fde8e8] text-[#9b1c1c]', high: 'bg-[#ffedd5] text-[#9a3412]', medium: 'bg-[#fef3c7] text-[#92400e]', low: 'bg-[#dcfce7] text-[#166534]',
};

function Score({ likelihood, impact }: { likelihood: string; impact: string }) {
  const score = inherentScore({ inherent_likelihood: likelihood, inherent_impact: impact });
  const band = bandOf(score);
  if (!score || !band) return <span className="text-[13px] text-[#586472]">Score shows here</span>;
  return <span className={`inline-flex h-7 items-center rounded-full px-2.5 text-[13px] font-medium ${BAND_STYLE[band]}`}>Score {score} · {BAND_LABEL[band]}</span>;
}

export default function AddToRegisterDialog({ risk, onClose, onAdded }: {
  risk: LibraryRisk | null;
  onClose: () => void;
  onAdded: (added: AddedRisk) => void;
}) {
  const [form, setForm] = useState<AddForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setForm(risk ? startForm(risk) : null); setError(null); }, [risk?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const people = useQuery({ queryKey: ['risk-library-people'], queryFn: riskLibraryApi.people, staleTime: 60_000, enabled: !!risk });
  const teams = useQuery({
    queryKey: ['risk-library-teams'], enabled: !!risk, staleTime: 60_000,
    queryFn: async () => { try { return (await teamsApi.list(false)).data || []; } catch { return []; } },
  });
  const already = risk?.in_register || null;

  const add = useMutation({
    mutationFn: (f: AddForm) => riskLibraryApi.add(risk!.id, requestBody(f, !!already)),
    onSuccess: (added) => { onAdded(added); },
    onError: (e) => setError(errorText(e, 'Could not add the risk.')),
  });

  const blocked = useMemo(() => (form ? problem(form) : null), [form]);
  const set = (change: Partial<AddForm>) => { setError(null); setForm((f) => (f ? { ...f, ...change } : f)); };
  if (!risk || !form) return null;

  const submit = (e: React.FormEvent) => { e.preventDefault(); if (!blocked && !add.isPending) add.mutate(form); };

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
              {add.isPending ? 'Adding…' : already ? 'Add again' : 'Add to register'}
            </button>
          </div>
        </div>
      }
    >
      <form id="risk-library-add" onSubmit={submit} className="space-y-4 px-1 py-1">
        <div className="rounded-lg bg-[#e6f6f3] px-3 py-2">
          <p className="text-[13px] leading-5 text-[#115e59]">
            <span className="font-medium">{risk.family_id} {risk.family_name}.</span> {risk.objective}
          </p>
        </div>

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
          <label htmlFor="rl-title" className={LABEL}>Title <span aria-hidden className="text-[#9b1c1c]">*</span></label>
          <input id="rl-title" className={FIELD} value={form.title} maxLength={255} onChange={(e) => set({ title: e.target.value })} aria-required />
        </div>
        <div>
          <label htmlFor="rl-description" className={LABEL}>Description</label>
          <textarea id="rl-description" rows={3} className={AREA} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="rl-category" className={LABEL}>Category</label>
            <select id="rl-category" className={FIELD} value={form.category} onChange={(e) => set({ category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rl-team" className={LABEL}>Team / department</label>
            <select id="rl-team" className={FIELD} value={form.team_id} onChange={(e) => set({ team_id: e.target.value })}>
              <option value="">Not set</option>
              {(teams.data || []).map((t: { id: number; name: string }) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rl-owner" className={LABEL}>Risk owner <span aria-hidden className="text-[#9b1c1c]">*</span></label>
            <select id="rl-owner" className={FIELD} value={form.owner_id} onChange={(e) => set({ owner_id: e.target.value })} aria-required>
              <option value="">Choose a person</option>
              {(people.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rl-business-owner" className={LABEL}>Business owner</label>
            <select id="rl-business-owner" className={FIELD} value={form.business_owner_id} onChange={(e) => set({ business_owner_id: e.target.value })}>
              <option value="">Not set</option>
              {(people.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        <fieldset className="rounded-lg border border-[#d8dee4] px-3 pb-3 pt-2">
          <legend className="px-1 text-[13px] font-medium text-[#26323d]">Rating (1 to 5)</legend>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label htmlFor="rl-il" className={LABEL}>Likelihood <span aria-hidden className="text-[#9b1c1c]">*</span></label>
              <select id="rl-il" className={FIELD} value={form.inherent_likelihood} onChange={(e) => set({ inherent_likelihood: e.target.value })} aria-required>
                <option value="">Choose</option>
                {LIKELIHOOD.map((l, i) => <option key={l} value={i + 1}>{i + 1} · {l}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rl-ii" className={LABEL}>Impact <span aria-hidden className="text-[#9b1c1c]">*</span></label>
              <select id="rl-ii" className={FIELD} value={form.inherent_impact} onChange={(e) => set({ inherent_impact: e.target.value })} aria-required>
                <option value="">Choose</option>
                {IMPACT.map((l, i) => <option key={l} value={i + 1}>{i + 1} · {l}</option>)}
              </select>
            </div>
            <div className="flex h-10 items-center"><Score likelihood={form.inherent_likelihood} impact={form.inherent_impact} /></div>
            <div>
              <label htmlFor="rl-rl" className={LABEL}>Residual likelihood</label>
              <select id="rl-rl" className={FIELD} value={form.residual_likelihood} onChange={(e) => set({ residual_likelihood: e.target.value })}>
                <option value="">Not rated</option>
                {LIKELIHOOD.map((l, i) => <option key={l} value={i + 1}>{i + 1} · {l}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rl-ri" className={LABEL}>Residual impact</label>
              <select id="rl-ri" className={FIELD} value={form.residual_impact} onChange={(e) => set({ residual_impact: e.target.value })}>
                <option value="">Not rated</option>
                {IMPACT.map((l, i) => <option key={l} value={i + 1}>{i + 1} · {l}</option>)}
              </select>
            </div>
            <div className="flex h-10 items-center"><Score likelihood={form.residual_likelihood} impact={form.residual_impact} /></div>
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <div>
            <label htmlFor="rl-plan" className={LABEL}>Treatment plan</label>
            <textarea id="rl-plan" rows={2} className={AREA} value={form.treatment_plan} onChange={(e) => set({ treatment_plan: e.target.value })} />
          </div>
          <div>
            <label htmlFor="rl-review" className={LABEL}>Review date</label>
            <input id="rl-review" type="date" className={FIELD} value={form.review_date} onChange={(e) => set({ review_date: e.target.value })} />
          </div>
        </div>
      </form>
    </AnimatedModal>
  );
}
