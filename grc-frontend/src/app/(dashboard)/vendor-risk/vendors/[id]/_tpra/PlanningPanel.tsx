'use client';

// Stage 03 — Due Diligence Planning. Persists the assessment plan (questionnaire
// template + assigned reviewer + due date) so the dd_planning exit gate can pass,
// lets you issue the questionnaire to the vendor, and manages the evidence request
// list (reused EvidencePanel).

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Send, CheckCircle2, ClipboardList } from 'lucide-react';
import { tpraApi, vendorRiskApi, adminApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import type { TpraAssessment } from './types';
import EvidencePanel from './EvidencePanel';

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const labelCls = 'mb-1 block text-xs font-medium text-gray-700';

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function PlanningPanel({
  vendorId, assessmentId, assessment,
}: { vendorId: number; assessmentId: number; assessment: TpraAssessment }) {
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

  const { data: users } = useQuery({
    queryKey: ['admin-users-for-tpra-intake'],
    queryFn: async () => {
      try {
        const r = await adminApi.getUsers();
        return ((r.data || []) as Array<{ id: number; email?: string; full_name?: string; name?: string; first_name?: string; last_name?: string }>).map((u) => ({
          id: u.id,
          name: u.full_name || u.name || [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || `User ${u.id}`,
        }));
      } catch { return []; }
    },
  });

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

  const sendQ = useMutation({
    mutationFn: () => vendorRiskApi.sendQuestionnaire({
      vendor_id: vendorId, assessment_id: assessmentId,
      template_id: templateId === '' ? null : Number(templateId),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] }); toast({ type: 'success', title: 'Questionnaire issued', message: 'Sent to the vendor for completion.' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not send', message: errMsg(e, 'Try again.') }),
  });

  const templateSet = templateId !== '';
  const reviewerSet = reviewerId !== '';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <ClipboardList className="h-4 w-4 text-primary-600" /> Assessment plan
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              {(users || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Target date</label>
            <input type="date" className={inputCls} value={dueDate} disabled={!canEdit}
              onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-3 text-[11px]">
            <span className={`inline-flex items-center gap-1 ${templateSet ? 'text-emerald-600' : 'text-gray-400'}`}>
              <CheckCircle2 className="h-3 w-3" /> Template {templateSet ? 'selected' : 'needed'}
            </span>
            <span className={`inline-flex items-center gap-1 ${reviewerSet ? 'text-emerald-600' : 'text-gray-400'}`}>
              <CheckCircle2 className="h-3 w-3" /> Reviewer {reviewerSet ? 'assigned' : 'needed'}
            </span>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <button onClick={() => sendQ.mutate()} disabled={sendQ.isPending || !templateSet}
                title={!templateSet ? 'Select a template first' : 'Issue the questionnaire to the vendor'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                {sendQ.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send questionnaire
              </button>
              <button onClick={() => savePlan.mutate()} disabled={savePlan.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {savePlan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save plan
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Evidence request list — SOC 2 / ISO / pen-test / DPA */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Evidence requests</p>
        <EvidencePanel assessmentId={assessmentId} title="Evidence pack" />
      </div>
    </div>
  );
}
