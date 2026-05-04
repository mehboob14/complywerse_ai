'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { attestationApi } from '@/lib/api';
import {
  ClipboardCheck,
  CheckCircle,
  Clock,
  AlertCircle,
  Calendar,
  ArrowRight,
  FileCheck,
  ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';

interface MyAttestation {
  id: number;
  campaign_id: number;
  campaign_name: string;
  attestation_type: string;
  status: 'pending' | 'completed' | 'overdue' | 'escalated';
  due_date?: string;
  completed_at?: string;
  evidence_id?: number;
  is_overdue?: boolean;
  days_until_due?: number;
  attestation_text?: string;
}

const TYPE_LABELS: Record<string, string> = {
  sox_302: 'SOX 302',
  sox_404: 'SOX 404',
  policy_signoff: 'Policy Sign-Off',
  bcp_awareness: 'BCP Awareness',
  training_acknowledgment: 'Training Acknowledgment',
  annual_certification: 'Annual Certification',
  policy_acknowledgment: 'Policy Acknowledgment',
};

export default function MyAttestationsPage() {
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');

  const { data: attestations, isLoading } = useQuery({
    queryKey: ['my-attestations'],
    queryFn: async () => {
      try {
        const response = await attestationApi.getMyAttestations();
        return response.data as MyAttestation[];
      } catch {
        return [] as MyAttestation[];
      }
    },
  });

  const all = attestations || [];
  const pending = all.filter(a => a.status === 'pending' || a.status === 'overdue' || a.status === 'escalated');
  const completed = all.filter(a => a.status === 'completed');
  const overdue = pending.filter(a => a.status === 'overdue' || a.is_overdue);

  const now = new Date();
  const thisMonthCompleted = completed.filter(a => {
    if (!a.completed_at) return false;
    const d = new Date(a.completed_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="page-header">
          <div className="skeleton h-8 w-48 mb-2" />
          <div className="skeleton h-5 w-64" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-4">
              <div className="skeleton h-8 w-12 mb-1" />
              <div className="skeleton h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="page-header">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/governance/attestations" className="text-gray-500 hover:text-black">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-black">My Attestations</h1>
            <p className="mt-1 text-gray-600">Your pending and completed attestation requests</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 flex-shrink-0">
            <Clock className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-black">{pending.length}</p>
            <p className="text-sm text-gray-500">Pending</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 flex-shrink-0">
            <AlertCircle className="h-5 w-5 text-rose-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-rose-600">{overdue.length}</p>
            <p className="text-sm text-gray-500">Overdue</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 flex-shrink-0">
            <CheckCircle className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-600">{thisMonthCompleted.length}</p>
            <p className="text-sm text-gray-500">Completed this month</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-6">
          <button
            onClick={() => setActiveTab('pending')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'pending'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-black'
            }`}
          >
            Pending & Overdue
            {pending.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full">
                {pending.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-black'
            }`}
          >
            Completed History
            {completed.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                {completed.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Pending tab */}
      {activeTab === 'pending' && (
        <div className="space-y-3">
          {pending.length === 0 ? (
            <div className="card p-10 text-center">
              <CheckCircle className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
              <p className="text-black font-medium">All caught up!</p>
              <p className="text-gray-500 text-sm mt-1">You have no pending attestations.</p>
            </div>
          ) : (
            pending.map((a) => {
              const isOverdue = a.status === 'overdue' || a.is_overdue;
              return (
                <div
                  key={a.id}
                  className={`card p-4 flex items-center justify-between gap-4 ${
                    isOverdue ? 'border-rose-200 bg-rose-50/20' : ''
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0 ${
                      isOverdue ? 'bg-rose-100' : 'bg-primary-500/10'
                    }`}>
                      <ClipboardCheck className={`h-4 w-4 ${isOverdue ? 'text-rose-500' : 'text-primary-500'}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-black font-medium text-sm truncate">{a.campaign_name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-gray-500">{TYPE_LABELS[a.attestation_type] || a.attestation_type?.replace(/_/g, ' ')}</span>
                        {a.due_date && (
                          <span className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-rose-600 font-medium' : 'text-gray-400'}`}>
                            <Calendar className="h-3 w-3" />
                            {isOverdue ? 'Was due: ' : 'Due: '}
                            {new Date(a.due_date).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Link
                    href={`/governance/attestations/complete/${a.id}`}
                    className={`btn-primary flex items-center gap-1.5 text-sm whitespace-nowrap flex-shrink-0 ${
                      isOverdue ? 'bg-rose-600 hover:bg-rose-700' : ''
                    }`}
                  >
                    Complete Now
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* History tab */}
      {activeTab === 'history' && (
        <div className="card overflow-hidden">
          {completed.length === 0 ? (
            <div className="p-10 text-center">
              <FileCheck className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No completed attestations yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-slate-50">
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-600">Campaign</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-600">Type</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-600">Completed</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-600">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {completed.map((a) => (
                    <tr key={a.id} className="border-b border-gray-100 hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <p className="text-black text-sm font-medium">{a.campaign_name}</p>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs text-gray-500">{TYPE_LABELS[a.attestation_type] || a.attestation_type?.replace(/_/g, ' ')}</span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 text-sm text-gray-600">
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                          {a.completed_at ? new Date(a.completed_at).toLocaleDateString() : '-'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {a.evidence_id ? (
                          <span className="text-xs text-emerald-600 font-medium">Attached</span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
