'use client';

// Stage 03 — Due Diligence Planning. Persists the assessment plan (questionnaire
// template + assigned reviewer + due date) so the dd_planning exit gate can pass,
// and manages the evidence request list (reused EvidencePanel). Sending the questionnaires
// is the Assessments tab's: this links to it rather than doing it twice.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePeople } from '../../../_lib/portfolioApi';
import { Loader2, Save, Send, CheckCircle2, ClipboardList } from 'lucide-react';
import { tpraApi, vendorRiskApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import type { TpraAssessment } from './types';
import EvidencePanel from './EvidencePanel';
import { reviewsApi } from '../../../_lib/reviewsApi';

const inputCls =
  'w-full rounded-ds-card border border-ds-border-strong bg-ds-surface px-3 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary focus-visible:border-ds-primary';
const labelCls = 'mb-1 block text-[12px] font-medium text-ds-fg-body';

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function PlanningPanel({
  vendorId, assessmentId, assessment, engagementId = null,
}: { vendorId: number; assessmentId: number; assessment: TpraAssessment; engagementId?: number | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');

  const { data: templates } = useQuery({
    queryKey: ['tpra-templates'],
    queryFn: async () => {
      const r = await vendorRiskApi.getTemplates({ limit: 200 });
      const d = r.data as unknown;
      const list = Array.isArray(d) ? d : ((d as { items?: unknown[] })?.items || []);
      return (list as Array<{ id: number; name?: string; title?: string }>).map((t) => ({ id: t.id, name: t.name || t.title || `Template ${t.id}` }));
    },
  });

  const users = usePeople();           // everyone who signs in here, from the module's own read

  const [templateId, setTemplateId] = useState<number | ''>('');
  const [reviewerId, setReviewerId] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    setTemplateId(assessment.template_id ?? '');
    setReviewerId(assessment.reviewed_by ?? '');
    setDueDate(assessment.due_date ? String(assessment.due_date).slice(0, 10) : '');
  }, [assessment.template_id, assessment.reviewed_by, assessment.due_date]);

  const savePlan = useMutation({
    mutationFn: () => tpraApi.savePlan(assessmentId, {
      template_id: templateId === '' ? undefined : Number(templateId),
      reviewed_by: reviewerId === '' ? undefined : Number(reviewerId),
      due_date: dueDate || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] }); toast({ type: 'success', title: 'Plan saved' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errMsg(e, 'Try again.') }),
  });

  // The gate's own count of different reviewers (the plan's, Assign duties, section reviewers). Under the
  // lifecycle's key, so whatever refreshes the lifecycle refreshes this.
  const { data: reviewers } = useQuery({
    queryKey: ['tpra-lifecycle', 'reviewers', assessmentId],
    queryFn: async () => (await reviewsApi.planning(assessmentId)).data,
  });
  const templateSet = templateId !== '';
  const reviewerSet = !!reviewers && reviewers.assigned >= reviewers.required;
  const reviewerLabel = !reviewers ? 'Reviewer needed'
    : reviewers.required > 1 ? `Reviewers ${reviewers.assigned}/${reviewers.required}`
      : reviewers.required === 0 && reviewers.assigned === 0 ? 'No reviewer needed'
        : `Reviewer ${reviewerSet ? 'assigned' : 'needed'}`;

  return (
    <div className="space-y-[16px]">
      <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
        <p className="mb-3 flex items-center gap-1.5 text-[12px] font-[600] text-ds-fg">
          <ClipboardList className="h-4 w-4 text-ds-primary-text" /> Assessment plan
        </p>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
          <div>
            <label className={labelCls}>Questionnaire template</label>
            <select className={inputCls} value={templateId} disabled={!canEdit}
              onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Select…</option>
              {(templates || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Assigned reviewer</label>
            <select className={inputCls} value={reviewerId} disabled={!canEdit}
              onChange={(e) => setReviewerId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Target date</label>
            <input type="date" className={inputCls} value={dueDate} disabled={!canEdit}
              onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-[12px] text-[12px]">
            <span className={`inline-flex items-center gap-1 ${templateSet ? 'text-ds-success' : 'text-ds-fg-muted'}`}>
              <CheckCircle2 className="h-3 w-3" /> Template {templateSet ? 'selected' : 'needed'}
            </span>
            <span className={`inline-flex items-center gap-1 ${reviewerSet ? 'text-ds-success' : 'text-ds-fg-muted'}`}
              title={reviewers?.roles.length ? `This tier needs ${reviewers.roles.join(', ')}` : undefined}>
              <CheckCircle2 className="h-3 w-3" /> {reviewerLabel}
            </span>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <Link href={`/vendor-risk/vendors/${vendorId}?tab=assessments${engagementId ? `&engagement=${engagementId}` : ''}`}
                className="inline-flex items-center gap-1.5 rounded-ds-card border border-ds-border-strong bg-ds-surface px-3 py-1.5 text-[12px] font-medium text-ds-fg-body hover:bg-ds-surface-subtle">
                <Send className="h-3.5 w-3.5" /> Send questionnaires
              </Link>
              <button onClick={() => savePlan.mutate()} disabled={savePlan.isPending}
                className="inline-flex items-center gap-1.5 rounded-ds-card bg-ds-primary px-3 py-1.5 text-[12px] font-medium text-ds-on-primary hover:bg-ds-primary-hover disabled:opacity-50">
                {savePlan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save plan
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Evidence request list — SOC 2 / ISO / pen-test / DPA */}
      <div>
        <p className="mb-1.5 text-[12px] font-[600] uppercase tracking-wide text-ds-fg-muted">Evidence requests</p>
        <EvidencePanel assessmentId={assessmentId} title="Evidence pack" />
      </div>
    </div>
  );
}
