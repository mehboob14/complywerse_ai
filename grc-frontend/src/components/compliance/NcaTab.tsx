'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  Shield, ClipboardList, Loader2, CheckCircle, Sparkles, FileSpreadsheet, Info,
} from 'lucide-react';
import DCCAssessmentTab from './DCCAssessmentTab';
import AuditPlanTab from './AuditPlanTab';
import { SlaClosurePanel } from './_redesign/SlaClosurePanel';
import type { SlaPolicy, SlaItemInput } from './_redesign/slaEngine';

interface TenantUser {
  id: number;
  label: string;
  email: string | null;
}

interface Props {
  assessmentId: number;
  tenantUsers: TenantUser[];
}

type SubTab = 'doc_assessment' | 'audit_plan';

export default function NcaTab({ assessmentId, tenantUsers }: Props) {
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<SubTab>('doc_assessment');
  const [initStatus, setInitStatus] = useState<{
    dcc?: { ok: boolean; message: string };
    audit?: { ok: boolean; message: string };
  } | null>(null);

  // Probe DCC initialization status
  const { data: dccData } = useQuery<{ initialized: boolean; summary: { total: number } }>({
    queryKey: ['dcc-assessment', assessmentId],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${assessmentId}/dcc`)).data,
    staleTime: 30_000,
  });

  // Probe audit plan presence (just count entries)
  const { data: auditData } = useQuery<{ entries: any[]; summary: { total: number } }>({
    queryKey: ['audit-plan-entries', assessmentId],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${assessmentId}/audit-plan`)).data,
    staleTime: 30_000,
  });

  // Flat DCC points (with SLA dates) for the closure panel + shared SLA policy.
  const { data: ncaItems = [] } = useQuery<SlaItemInput[]>({
    queryKey: ['nca-sla-items', assessmentId],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${assessmentId}`)).data?.items || [],
    staleTime: 30_000,
  });
  const { data: slaPolicy } = useQuery<SlaPolicy>({
    queryKey: ['redesign-sla-policy'],
    queryFn: async () => (await apiClient.get('/compliance/assessments/sla-policy')).data,
    staleTime: 60_000,
  });
  const saveSlaPolicy = async (p: SlaPolicy) => {
    await apiClient.put('/compliance/assessments/sla-policy', null, { params: p as unknown as Record<string, number> });
    queryClient.invalidateQueries({ queryKey: ['redesign-sla-policy'] });
  };

  const dccInitialized = !!dccData?.initialized;
  const auditEntryCount = auditData?.summary?.total ?? 0;
  const isFullyInitialized = dccInitialized;  // audit plan has no fixed seed; user-driven

  const initMut = useMutation({
    mutationFn: async () => {
      const result: { dcc?: { ok: boolean; message: string }; audit?: { ok: boolean; message: string } } = {};

      // 1) DCC: idempotent — seeds 66 controls if not already present
      try {
        const res = await apiClient.post(`/compliance/assessments/${assessmentId}/dcc/initialize`);
        result.dcc = { ok: true, message: res.data?.message || 'DCC controls initialized' };
      } catch (e: any) {
        result.dcc = { ok: false, message: e?.response?.data?.detail || 'DCC initialization failed' };
      }

      // 2) Audit plan: nothing to seed, just confirm the section is ready
      result.audit = {
        ok: true,
        message: 'Audit plan ready — add audit/review entries via the Audit Plan tab',
      };

      return result;
    },
    onSuccess: (result) => {
      setInitStatus(result);
      queryClient.invalidateQueries({ queryKey: ['dcc-assessment', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['audit-plan-entries', assessmentId] });
    },
  });

  return (
    <div className="space-y-4">
      {/* Header banner */}
      <div className="rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-5">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-white border border-blue-200 flex items-center justify-center flex-shrink-0">
              <Shield className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">NCA Cybersecurity Templates</h3>
              <p className="text-sm text-slate-600 mt-0.5">
                One-time setup loads the DCC-1:2022 control catalogue and prepares the Cybersecurity Audit Plan section.
              </p>
              <div className="flex items-center gap-4 mt-3 text-xs">
                <div className="flex items-center gap-1.5">
                  {dccInitialized ? (
                    <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <div className="h-3.5 w-3.5 rounded-full border-2 border-gray-300" />
                  )}
                  <span className={dccInitialized ? 'text-green-700' : 'text-gray-600'}>
                    DCC Compliance ({dccData?.summary?.total ?? 0} controls)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {auditEntryCount > 0 ? (
                    <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <div className="h-3.5 w-3.5 rounded-full border-2 border-gray-300" />
                  )}
                  <span className={auditEntryCount > 0 ? 'text-green-700' : 'text-gray-600'}>
                    Audit Plan ({auditEntryCount} entries)
                  </span>
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={() => initMut.mutate()}
            disabled={initMut.isPending || isFullyInitialized}
            className="px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 flex-shrink-0"
          >
            {initMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isFullyInitialized ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isFullyInitialized ? 'Initialized' : 'Initialize NCA Templates'}
          </button>
        </div>

        {initStatus && (
          <div className="mt-4 space-y-1.5 border-t border-blue-100 pt-3">
            {initStatus.dcc && (
              <div className={`text-xs flex items-center gap-2 ${initStatus.dcc.ok ? 'text-green-700' : 'text-rose-700'}`}>
                <Shield className="h-3.5 w-3.5" /> DCC: {initStatus.dcc.message}
              </div>
            )}
            {initStatus.audit && (
              <div className={`text-xs flex items-center gap-2 ${initStatus.audit.ok ? 'text-green-700' : 'text-rose-700'}`}>
                <ClipboardList className="h-3.5 w-3.5" /> Audit Plan: {initStatus.audit.message}
              </div>
            )}
          </div>
        )}

        {!dccInitialized && !initStatus && (
          <div className="mt-3 flex items-center gap-2 text-xs text-blue-700">
            <Info className="h-3.5 w-3.5" />
            DCC will be seeded with 66 controls. Audit Plan starts empty — add entries from the template manually.
          </div>
        )}
      </div>

      {/* Sub-tab navigation */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        <button
          onClick={() => setSubTab('doc_assessment')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            subTab === 'doc_assessment'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          DCC Compliance Assessment
        </button>
        <button
          onClick={() => setSubTab('audit_plan')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            subTab === 'audit_plan'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <ClipboardList className="h-4 w-4" />
          Cybersecurity Audit Plan
        </button>
      </div>

      {/* Sub-tab content */}
      {subTab === 'doc_assessment' && (
        <DCCAssessmentTab assessmentId={assessmentId} tenantUsers={tenantUsers} />
      )}
      {subTab === 'audit_plan' && (
        <AuditPlanTab assessmentId={assessmentId} tenantUsers={tenantUsers} />
      )}
    </div>
  );
}
