'use client';

// The old Assessments tab, kept whole: every assessment of the vendor in a table, each opening its review page, and "New
// assessment" for one made and approved on its own page rather than through the lifecycle. The lifecycle's questionnaires are
// the cards above; this is what they replaced and the one thing they do not do.
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePeople } from '../../../_lib/portfolioApi';
import { Plus } from 'lucide-react';
import { BTN, BTN_PRIMARY } from '../_record/btn';
import { Dialog, StatusPill, TierBadge } from '../_record/recordUi';
import RecordPanel from '../_record/RecordPanel';
import { fmt } from '../../../_ui/fmt';
import { statusPill } from '@/lib/status';
import { vendorAssessment } from '@/lib/statuses/vendor';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText } from '@/lib/apiError';
import { vendorRiskApi } from '@/lib/api';

interface Legacy {
  id: number;
  assessment_type: string;
  status: string;
  inherent_score: number | null;
  risk_rating: string | null;
  due_date: string | null;
  assessor: { id: number; full_name: string } | string | null;
}

const TYPES = [
  { id: 'cybersecurity', label: 'Cybersecurity assessment' },
  { id: 'privacy_data_protection', label: 'Privacy & data protection' },
  { id: 'operational_risk', label: 'Operational risk assessment' },
  { id: 'compliance_regulatory', label: 'Compliance & regulatory' },
  { id: 'financial_risk', label: 'Financial risk assessment' },
  { id: 'initial_onboarding', label: 'Initial onboarding assessment' },
  { id: 'periodic_review', label: 'Periodic review' },
];
const FIELD = 'h-9 w-full rounded-ds-card border border-ds-border-strong bg-ds-surface px-2.5 text-[13px] text-ds-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary';
const LABEL = 'mb-1 block text-[13px] font-medium text-ds-fg-body';
const TH = 'whitespace-nowrap px-3 py-2 text-left text-[12px] font-[600] uppercase tracking-wide text-ds-fg-muted';
const TD = 'px-3 py-2.5 text-[13px] text-ds-fg-body';
const words = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export default function LegacyAssessments({ vendorId }: { vendorId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('vendor_risk:assessments:create') || hasPermission('erm:risks:edit');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ assessment_type: 'cybersecurity', due_date: '', assessed_by: '' });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['vendor-assessments', vendorId],
    queryFn: async () => {
      const d = (await vendorRiskApi.getAssessments({ vendor_id: vendorId })).data;
      return (Array.isArray(d) ? d : d.items ?? []) as Legacy[];
    },
  });
  const users = usePeople();

  const create = useMutation({
    mutationFn: async () => (await vendorRiskApi.createAssessment({
      assessment_type: form.assessment_type, vendor_id: vendorId,
      ...(form.due_date ? { due_date: form.due_date } : {}),
      ...(form.assessed_by ? { assessed_by: Number(form.assessed_by) } : {}),
    })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendor-assessments', vendorId] });
      setAdding(false);
      setForm({ assessment_type: 'cybersecurity', due_date: '', assessed_by: '' });
      toast({ type: 'success', title: 'Assessment created' });
    },
    onError: (e) => toast({ type: 'error', title: 'Not created', message: apiErrorText(e, 'Try again.') }),
  });

  const items = data ?? [];
  return (
    <>
      <RecordPanel
        title="Legacy assessments"
        count={items.length}
        info="Assessments made on their own, outside the lifecycle. The questionnaires of a review are the cards above."
        action={canCreate ? (
          <button type="button" className={BTN} onClick={() => setAdding(true)}><Plus aria-hidden className="h-4 w-4" /> New assessment</button>
        ) : undefined}
      >
        {isLoading ? (
          <p className="px-[20px] pb-5 text-[13px] text-ds-fg-muted">Loading…</p>
        ) : isError ? (
          <p role="alert" className="px-[20px] pb-5 text-[13px] text-ds-danger">The assessments could not be loaded.</p>
        ) : items.length === 0 ? (
          <p className="px-[20px] pb-5 text-[13px] text-ds-fg-muted">None yet.</p>
        ) : (
          <div className="overflow-x-auto pb-2" tabIndex={0} role="region" aria-label="Table of legacy assessments">
            <table className="min-w-full">
              <thead>
                <tr className="border-y border-ds-border bg-ds-surface-subtle">
                  {['Type', 'Status', 'Score', 'Rating', 'Assessor', 'Due', 'Questions'].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-ds-border">
                {items.map((a) => {
                  const review = `/vendor-risk/assessments/${a.id}?tab=questionnaire`;
                  return (
                    <tr key={a.id}>
                      <td className={TD}><Link href={review} className="font-medium text-ds-primary-text hover:underline">{words(a.assessment_type || 'assessment')}</Link></td>
                      <td className={TD}><StatusPill tone={statusPill(vendorAssessment, a.status).tone} variant="inline">{words(a.status || '')}</StatusPill></td>
                      <td className={`${TD} tabular-nums`}>{a.inherent_score != null ? a.inherent_score.toFixed(1) : '-'}</td>
                      <td className={TD}>{a.risk_rating ? <TierBadge tier={a.risk_rating} variant="dot" /> : '-'}</td>
                      <td className={TD}>{typeof a.assessor === 'object' && a.assessor ? a.assessor.full_name : a.assessor ? String(a.assessor) : '-'}</td>
                      <td className={`${TD} whitespace-nowrap`}>{a.due_date ? fmt.date(a.due_date) : '-'}</td>
                      <td className={TD}><Link href={review} className="whitespace-nowrap text-ds-primary-text hover:underline">View linked questions</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </RecordPanel>

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="New assessment"
        footer={(
          <>
            <button type="button" className={BTN} onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" form="legacy-assessment-form" className={BTN_PRIMARY} disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create'}</button>
          </>
        )}
      >
        <form id="legacy-assessment-form" className="space-y-[14px]" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div>
            <label htmlFor="legacy-type" className={LABEL}>Type</label>
            <select id="legacy-type" className={FIELD} value={form.assessment_type} onChange={(e) => setForm({ ...form, assessment_type: e.target.value })}>
              {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="legacy-due" className={LABEL}>Due date <span className="font-normal text-ds-fg-muted">(optional)</span></label>
            <input id="legacy-due" type="date" className={FIELD} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
          <div>
            <label htmlFor="legacy-assessor" className={LABEL}>Assessor</label>
            <select id="legacy-assessor" className={FIELD} value={form.assessed_by} onChange={(e) => setForm({ ...form, assessed_by: e.target.value })}>
              <option value="">Me</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </form>
      </Dialog>
    </>
  );
}
