'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  ClipboardCheck,
  Eye,
  Play,
  ArrowRight,
  Loader2,
  AlertCircle,
  Calendar,
  Building2,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { SearchInput } from '@/components/ui/SearchInput';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { PageLoader } from '@/components/ui';

interface Assessment {
  id: number;
  campaign_id: number;
  campaign_name: string;
  business_unit: string;
  assessor_name: string;
  status: 'not_started' | 'in_progress' | 'submitted' | 'under_review' | 'approved' | 'rejected';
  score?: number;
  due_date: string;
  created_at: string;
  updated_at: string;
  progress: number;
}

interface Campaign {
  id: number;
  name: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  not_started: { bg: 'bg-slate-500/20', text: 'text-slate-600', label: 'Not Started' },
  in_progress: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'In Progress' },
  submitted: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Submitted' },
  under_review: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Under Review' },
  approved: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Approved' },
  rejected: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Rejected' },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] || STATUS_STYLES.not_started;
}

function formatDate(dateString?: string) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function RCSAAssessmentsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [campaignFilter, setCampaignFilter] = useState<string>('');
  const [businessUnitFilter, setBusinessUnitFilter] = useState<string>('');
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('risks:rcsa:edit');

  const { data: assessments, isLoading, error } = useQuery({
    queryKey: ['rcsa-assessments', statusFilter, campaignFilter, businessUnitFilter],
    queryFn: async () => {
      try {
        const params: Record<string, unknown> = {};
        if (statusFilter) params.status = statusFilter;
        if (campaignFilter) params.campaign_id = campaignFilter;
        if (businessUnitFilter) params.business_unit = businessUnitFilter;
        const response = await rcsaApi.getAssessments(params);
        return response.data as Assessment[];
      } catch {
        return [] as Assessment[];
      }
    },
  });

  const { data: campaigns } = useQuery({
    queryKey: ['rcsa-campaigns-list'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getCampaigns();
        return response.data as Campaign[];
      } catch {
        return [] as Campaign[];
      }
    },
  });

  const startMutation = useMutation({
    mutationFn: (id: number) => rcsaApi.startAssessment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-assessments'] });
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => rcsaApi.submitAssessment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-assessments'] });
    },
  });

  const businessUnits = useMemo(() => {
    if (!assessments) return [];
    const units = Array.from(new Set(assessments.map(a => a.business_unit)));
    return units.sort();
  }, [assessments]);

  const filteredAssessments = useMemo(() => {
    if (!assessments) return [];
    return assessments.filter(assessment => {
      const matchesSearch = !searchTerm || 
        assessment.campaign_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        assessment.business_unit.toLowerCase().includes(searchTerm.toLowerCase()) ||
        assessment.assessor_name.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });
  }, [assessments, searchTerm]);

  const getActionButton = (assessment: Assessment) => {
    switch (assessment.status) {
      case 'not_started':
        return canEdit ? (
          <button
            onClick={() => startMutation.mutate(assessment.id)}
            disabled={startMutation.isPending}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-primary-500/20 text-primary-400 hover:bg-primary-500/30"
          >
            <Play className="h-3.5 w-3.5" />
            Start
          </button>
        ) : null;
      case 'in_progress':
        return (
          <Link
            href={`/risks/rcsa/assessments/${assessment.id}`}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            Continue
          </Link>
        );
      case 'rejected':
        return (
          <Link
            href={`/risks/rcsa/assessments/${assessment.id}`}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            Revise
          </Link>
        );
      default:
        return (
          <Link
            href={`/risks/rcsa/assessments/${assessment.id}`}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-slate-500/20 text-slate-600 hover:bg-slate-500/30"
          >
            <Eye className="h-3.5 w-3.5" />
            View
          </Link>
        );
    }
  };

  if (isLoading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
        <p className="mt-2 text-red-400">Failed to load assessments</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900">RCSA Assessments</h1>
            <p className="text-slate-600 mt-1 text-sm">View and complete your assigned risk assessments</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-md">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search assessments..."
          />
        </div>
        <MultiSelectDropdown
          title="Campaign"
          items={(campaigns || []).map((c) => ({ value: String(c.id), label: c.name }))}
          selectedValues={campaignFilter ? [campaignFilter] : []}
          onApply={(vals) => setCampaignFilter(vals[0] || '')}
          multiSelect={false}
        />
        <MultiSelectDropdown
          title="Status"
          items={[
            { value: 'not_started', label: 'Not Started' },
            { value: 'in_progress', label: 'In Progress' },
            { value: 'submitted', label: 'Submitted' },
            { value: 'under_review', label: 'Under Review' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
          ]}
          selectedValues={statusFilter ? [statusFilter] : []}
          onApply={(vals) => setStatusFilter(vals[0] || '')}
          multiSelect={false}
        />
        <MultiSelectDropdown
          title="Business Unit"
          items={businessUnits.map((unit) => ({ value: unit, label: unit }))}
          selectedValues={businessUnitFilter ? [businessUnitFilter] : []}
          onApply={(vals) => setBusinessUnitFilter(vals[0] || '')}
          multiSelect={false}
        />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-white/50">
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Campaign</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Business Unit</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Assessor</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Status</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Score</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Due Date</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAssessments.map((assessment) => {
              const statusStyle = getStatusStyle(assessment.status);
              const isOverdue = new Date(assessment.due_date) < new Date() && !['approved', 'rejected'].includes(assessment.status);
              
              return (
                <tr key={assessment.id} className="border-b border-slate-200/50 hover:bg-white/50">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="h-4 w-4 text-primary-400" />
                      <span className="text-slate-900 font-medium">{assessment.campaign_name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2 text-slate-700">
                      <Building2 className="h-4 w-4 text-slate-500" />
                      {assessment.business_unit}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2 text-slate-700">
                      <User className="h-4 w-4 text-slate-500" />
                      {assessment.assessor_name}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                      {statusStyle.label}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {assessment.score !== undefined ? (
                      <span className={`font-medium ${
                        assessment.score >= 80 ? 'text-green-400' : 
                        assessment.score >= 60 ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                        {assessment.score}%
                      </span>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className={`flex items-center gap-2 ${isOverdue ? 'text-red-400' : 'text-slate-700'}`}>
                      <Calendar className="h-4 w-4" />
                      {formatDate(assessment.due_date)}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {getActionButton(assessment)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredAssessments.length === 0 && (
          <div className="p-12 text-center">
            <ClipboardCheck className="h-12 w-12 text-slate-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">No Assessments Found</h3>
            <p className="text-slate-600">
              {searchTerm || statusFilter || campaignFilter || businessUnitFilter
                ? 'No assessments match your filters'
                : 'No assessments have been assigned yet'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
