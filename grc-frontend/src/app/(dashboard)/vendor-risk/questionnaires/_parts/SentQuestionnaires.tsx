'use client';

// Every questionnaire sent to a supplier: where it stands, its answers, and its link (copy, open, send a new one). This is the
// "Sent questionnaires" table the page has always had, moved here as it was; the answers open in a panel beside it.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Eye, Loader2, RotateCw } from 'lucide-react';
import { vendorRiskApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText } from '@/lib/apiError';
import { parseUtc } from '@/lib/serverTime';
import { Panel, StatusPill, fmt, type Tone } from '@/app/(dashboard)/vendor-risk/_ui';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import { absoluteLink, portalApi } from '../../_lib/portalApi';
import type { Template } from '../../_lib/questionnaires/types';

interface VendorOption { id: number; name: string }
interface AssessmentOption { id: number; vendor_id: number; assessment_type: string; status: string }
interface ResponseRecord {
  id: number; vendor_id: number; assessment_id: number | null; template_id: number | null;
  respondent_name: string | null; respondent_email: string | null; responses: Record<string, unknown>; status: string;
  token: string | null;               // null once accepted, and on personal links (the contact has the link)
  contact_id?: number | null;         // the supplier contact its personal links go to
  expires_at: string | null; due_date?: string | null; submitted_at: string | null; created_at: string | null;
}

const TONE: Record<string, Tone> = {
  pending: 'pending', in_progress: 'progress', submitted: 'progress', under_review: 'progress', returned: 'warning', accepted: 'success', expired: 'neutral',
};
const WAITING = ['pending', 'in_progress', 'returned'];
const formatAssessmentType = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const questionnaireLink = (token: string) =>
  `${typeof window === 'undefined' ? '' : window.location.origin}/vendor-risk/questionnaires/${token}`;

function formatAnswer(answer: unknown): string {
  if (answer === null || answer === undefined || answer === '') return 'No answer provided';
  if (typeof answer === 'string' || typeof answer === 'number' || typeof answer === 'boolean') return String(answer);
  if (typeof answer === 'object' && 'answer' in (answer as Record<string, unknown>)) {
    const nested = (answer as Record<string, unknown>).answer;
    if (nested === null || nested === undefined || nested === '') return 'No answer provided';
    return typeof nested === 'object' ? JSON.stringify(nested) : String(nested);
  }
  return JSON.stringify(answer);
}

export function SentQuestionnaires({ templates }: { templates: Template[] }) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  // The rights the server checks (routers/questionnaires.py), with its erm:risks:edit fallback.
  const canResend = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');
  const canEditVendors = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');     // personal links are issued on the supplier
  const [selected, setSelected] = useState<ResponseRecord | null>(null);

  const { data: responses } = useQuery({
    queryKey: ['questionnaire-responses'],
    queryFn: async () => {
      const data = (await vendorRiskApi.getQuestionnaireResponses()).data;
      return (Array.isArray(data) ? data : []) as ResponseRecord[];
    },
    placeholderData: keepPreviousData,
    ...TPRM_QUERY_OPTS,
  });
  const { data: vendors } = useQuery({
    queryKey: ['vendors-select'],
    queryFn: async () => {
      const data = (await vendorRiskApi.getVendors()).data;
      return (Array.isArray(data) ? data : data.items ?? []) as VendorOption[];
    },
    placeholderData: keepPreviousData,
    ...TPRM_QUERY_OPTS,
  });
  const { data: assessments } = useQuery({
    queryKey: ['vendor-assessments-for-questionnaires'],
    queryFn: async () => {
      const data = (await vendorRiskApi.getAssessments({ limit: 1000 })).data;
      return (Array.isArray(data) ? data : data.items ?? []) as AssessmentOption[];
    },
    placeholderData: keepPreviousData,
    ...TPRM_QUERY_OPTS,
  });

  const templatesById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const vendorsById = useMemo(() => new Map((vendors || []).map((v) => [v.id, v])), [vendors]);
  const assessmentsById = useMemo(() => new Map((assessments || []).map((a) => [a.id, a])), [assessments]);
  const rows = useMemo(
    () => (responses || []).slice().sort((a, b) => (parseUtc(b.created_at)?.getTime() ?? 0) - (parseUtc(a.created_at)?.getTime() ?? 0)),
    [responses],
  );

  const copy = (value: string) => navigator.clipboard?.writeText(value);

  // A resend emails the contact a new personal link (copied here too); a link of the questionnaire's own, from before personal
  // links, stops working.
  const resend = useMutation({
    mutationFn: async (id: number) => (await vendorRiskApi.resendQuestionnaire(id)).data,
    onSuccess: (data: { token?: string | null; link?: string | null }) => {
      queryClient.invalidateQueries({ queryKey: ['questionnaire-responses'] });
      if (data?.link) copy(absoluteLink(data.link));
      else if (data?.token) copy(questionnaireLink(data.token));
    },
    onError: (e: unknown) => window.alert(apiErrorText(e, 'The questionnaire could not be sent again.')),
  });
  // A questionnaire on personal links has no link of its own: a fresh one for its contact, to copy.
  const contactLink = useMutation({
    mutationFn: async (r: ResponseRecord) =>
      `${absoluteLink((await portalApi.issueLink(r.vendor_id, r.contact_id as number, { send_email: false })).data.link)}?q=${r.id}`,
    onSuccess: (link) => copy(link),
    onError: (e: unknown) => window.alert(apiErrorText(e, 'No link could be made.')),
  });

  const template = selected?.template_id ? templatesById.get(selected.template_id) : undefined;

  return (
    <>
      <Panel title="Sent questionnaires" count={rows.length} info="Track sent links and response status, and read the questions and answers of each supplier's submission." flush>
        <div tabIndex={0} aria-label="Sent questionnaires" className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['ID', 'Vendor', 'Questionnaire', 'Assessment', 'Status', 'Answered', 'Submitted'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">No sent questionnaires yet.</td></tr>
              ) : rows.map((r) => {
                const t = r.template_id ? templatesById.get(r.template_id) : undefined;
                const vendor = vendorsById.get(r.vendor_id);
                const assessment = r.assessment_id ? assessmentsById.get(r.assessment_id) : undefined;
                const answered = Object.keys(r.responses || {}).length;
                const total = t?.questions?.length || answered;
                const link = r.token ? questionnaireLink(r.token) : null;
                const waiting = WAITING.includes(r.status);
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-500 font-mono">#{r.id}</td>
                    <td className="px-4 py-3 text-sm text-gray-800">
                      {vendor ? <Link href={`/vendor-risk/vendors/${vendor.id}`} className="text-primary-600 hover:text-primary-800">{vendor.name}</Link> : `Vendor #${r.vendor_id}`}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{t?.name || (r.template_id ? `Questionnaire #${r.template_id}` : 'No questionnaire')}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {assessment ? (
                        <Link href={`/vendor-risk/assessments/${assessment.id}`} className="text-primary-600 hover:text-primary-800">
                          #{assessment.id} {formatAssessmentType(assessment.assessment_type)}
                        </Link>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={TONE[r.status] ?? 'neutral'}>{r.status?.replace(/_/g, ' ')}</StatusPill>
                      {waiting && r.due_date && <div className="mt-0.5 text-[11px] text-gray-500">Due {fmt.date(r.due_date)}</div>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{total > 0 ? `${answered}/${total}` : `${answered}`}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{r.submitted_at ? fmt.date(r.submitted_at) : '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => setSelected(r)} aria-label={`View questions and answers for response #${r.id}`}
                          className="p-1.5 text-gray-500 hover:text-primary-700 rounded" title="View questions and answers">
                          <Eye className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                        {link && (
                          <>
                            <button onClick={() => copy(link)} aria-label={`Copy response link for response #${r.id}`}
                              className="p-1.5 text-gray-500 hover:text-gray-700 rounded" title="Copy response link">
                              <Copy className="h-4 w-4" strokeWidth={1.75} />
                            </button>
                            <a href={link} target="_blank" rel="noopener noreferrer" aria-label={`Open response link for response #${r.id} in a new tab`}
                              className="p-1.5 text-gray-500 hover:text-primary-700 rounded" title="Open response link">
                              <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
                            </a>
                          </>
                        )}
                        {!link && waiting && r.contact_id && canEditVendors && (
                          <button onClick={() => contactLink.mutate(r)} disabled={contactLink.isPending}
                            aria-label={`Copy the contact's link for response #${r.id}`}
                            className="p-1.5 text-gray-500 hover:text-gray-700 rounded disabled:opacity-50" title="Copy the contact's personal link">
                            <Copy className="h-4 w-4" strokeWidth={1.75} />
                          </button>
                        )}
                        {canResend && waiting && (
                          <button
                            onClick={() => {
                              if (window.confirm(r.token
                                ? 'Send a new link? The current link stops working, and the new one is copied for you.'
                                : 'Email the contact a new link? It is copied for you too.')) resend.mutate(r.id);
                            }}
                            disabled={resend.isPending}
                            aria-label={`Send a new link for response #${r.id}`}
                            className="p-1.5 text-gray-500 hover:text-primary-700 rounded disabled:opacity-50" title="Send a new link"
                          >
                            {resend.isPending && resend.variables === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" strokeWidth={1.75} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <RightSlidePanel
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `Questionnaire Response #${selected.id}` : ''}
        subtitle={template?.name || 'Questionnaire unavailable'}
        width="w-full max-w-3xl"
      >
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                ['Vendor', vendorsById.get(selected.vendor_id)?.name || `Vendor #${selected.vendor_id}`],
                ['Respondent', selected.respondent_name || selected.respondent_email || 'Not provided'],
                ['Status', selected.status?.replace(/_/g, ' ')],
                ['Submitted', selected.submitted_at ? fmt.date(selected.submitted_at) : '-'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-sm font-medium text-slate-900 mt-1 capitalize">{value}</p>
                </div>
              ))}
            </div>
            {template?.questions?.length ? (
              <div className="space-y-3">
                {template.questions.map((question, index) => (
                  <div key={`${question.id}-${index}`} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-slate-900 flex-1">
                        <span className="text-gray-400 font-mono mr-2">Q{index + 1}.</span>
                        {question.text}
                      </p>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{question.type.replace(/_/g, '/')}</span>
                    </div>
                    <div className="mt-2 rounded bg-gray-50 border border-gray-200 p-2 text-sm text-gray-800">
                      {formatAnswer((selected.responses || {})[String(question.id)])}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-sm font-medium text-gray-700 mb-2">Raw Responses</p>
                {Object.keys(selected.responses || {}).length === 0 ? (
                  <p className="text-sm text-gray-400">No responses submitted yet.</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(selected.responses || {}).map(([id, answer]) => (
                      <div key={id} className="text-sm text-gray-800 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                        <p className="text-xs text-gray-500 mb-1">{id}</p>
                        <p>{formatAnswer(answer)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </RightSlidePanel>
    </>
  );
}
