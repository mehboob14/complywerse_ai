'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { risksApi } from '@/lib/api';
import { Risk, RiskCategory } from '@/types';
import { 
  AlertTriangle, 
  Loader2, 
  AlertCircle, 
  Search, 
  Filter,
  Plus,
  X,
  TrendingUp,
  TrendingDown,
  Target
} from 'lucide-react';

type StatusFilter = 'all' | 'identified' | 'assessed' | 'mitigated' | 'accepted' | 'closed';

const RISK_CATEGORIES = [
  { value: 'strategic', label: 'Strategic', color: 'bg-purple-500' },
  { value: 'operational', label: 'Operational', color: 'bg-blue-500' },
  { value: 'financial', label: 'Financial', color: 'bg-green-500' },
  { value: 'compliance', label: 'Compliance', color: 'bg-yellow-500' },
  { value: 'reputational', label: 'Reputational', color: 'bg-orange-500' },
  { value: 'cybersecurity', label: 'Cyber', color: 'bg-red-500' },
];

export default function RisksPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRisk, setEditingRisk] = useState<Risk | null>(null);
  const queryClient = useQueryClient();

  const { data: risks, isLoading, error } = useQuery({
    queryKey: ['risks'],
    queryFn: async () => {
      const response = await risksApi.getAll();
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Risk>) => risksApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risks'] });
      setIsModalOpen(false);
      setEditingRisk(null);
    },
  });

  const getSeverityColor = (score: number) => {
    if (score >= 15) return 'bg-red-500';
    if (score >= 10) return 'bg-orange-500';
    if (score >= 5) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      identified: 'bg-slate-700 text-slate-300',
      assessed: 'bg-blue-900/50 text-blue-400',
      mitigated: 'bg-green-900/50 text-green-400',
      accepted: 'bg-yellow-900/50 text-yellow-400',
      closed: 'bg-slate-700 text-slate-400',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs ${styles[status] || styles.identified}`}>
        {status}
      </span>
    );
  };

  const filteredRisks = risks?.filter((risk: Risk) => {
    const matchesSearch = 
      risk.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      risk.description?.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (statusFilter === 'all') return matchesSearch;
    return matchesSearch && risk.status === statusFilter;
  });

  const riskMatrix = Array(5).fill(null).map(() => Array(5).fill(0));
  risks?.forEach((risk: Risk) => {
    const likelihoodIndex = Math.min(Math.max(risk.likelihood - 1, 0), 4);
    const impactIndex = Math.min(Math.max(risk.impact - 1, 0), 4);
    riskMatrix[4 - likelihoodIndex][impactIndex]++;
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load risks</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Risk Register</h1>
          <p className="text-slate-400">Track and manage organizational risks</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
        >
          <Plus size={18} />
          Add Risk
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-1">
          <h2 className="mb-4 text-lg font-semibold text-white">Risk Matrix</h2>
          <div className="aspect-square">
            <div className="grid h-full grid-cols-5 gap-1">
              {riskMatrix.map((row, i) =>
                row.map((count, j) => {
                  const severity = (5 - i) * (j + 1);
                  return (
                    <div
                      key={`${i}-${j}`}
                      className={`flex items-center justify-center rounded text-xs font-medium ${
                        severity >= 15
                          ? 'bg-red-900/50 text-red-400'
                          : severity >= 10
                          ? 'bg-orange-900/50 text-orange-400'
                          : severity >= 5
                          ? 'bg-yellow-900/50 text-yellow-400'
                          : 'bg-green-900/50 text-green-400'
                      }`}
                    >
                      {count > 0 && count}
                    </div>
                  );
                })
              )}
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-500">
              <span>Low Impact</span>
              <span>High Impact</span>
            </div>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search risks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              >
                <option value="all">All Status</option>
                <option value="identified">Identified</option>
                <option value="assessed">Assessed</option>
                <option value="mitigated">Mitigated</option>
                <option value="accepted">Accepted</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            {filteredRisks?.map((risk: Risk) => {
              const category = RISK_CATEGORIES.find(c => c.value === risk.category);
              return (
                <div 
                  key={risk.id} 
                  className="card hover:border-primary-500/50 transition-colors cursor-pointer"
                  onClick={() => {
                    setEditingRisk(risk);
                    setIsModalOpen(true);
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className={`mt-1 h-3 w-3 rounded-full ${category?.color || 'bg-slate-500'}`} />
                      <div>
                        <h3 className="font-medium text-white">{risk.title}</h3>
                        <p className="text-sm text-slate-400 line-clamp-1">{risk.description}</p>
                      </div>
                    </div>
                    {getStatusBadge(risk.status)}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <span className="text-slate-500">Inherent:</span>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${getSeverityColor(risk.inherent_risk_score)} text-white`}>
                          {risk.inherent_risk_score}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-slate-500">Residual:</span>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${getSeverityColor(risk.residual_risk_score)} text-white`}>
                          {risk.residual_risk_score}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <Target size={12} />
                      {risk.target_date ? new Date(risk.target_date).toLocaleDateString() : 'No target'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {(!filteredRisks || filteredRisks.length === 0) && (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-white">No risks found</h3>
          <p className="mt-1 text-slate-400">Add your first risk to start tracking</p>
        </div>
      )}

      {isModalOpen && (
        <RiskModal
          risk={editingRisk}
          onClose={() => {
            setIsModalOpen(false);
            setEditingRisk(null);
          }}
          onSave={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
        />
      )}
    </div>
  );
}

function RiskModal({
  risk,
  onClose,
  onSave,
  isLoading,
}: {
  risk: Risk | null;
  onClose: () => void;
  onSave: (data: Partial<Risk>) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    title: risk?.title || '',
    description: risk?.description || '',
    category: risk?.category || 'operational',
    likelihood: risk?.likelihood || 3,
    impact: risk?.impact || 3,
    treatment_plan: risk?.treatment_plan || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      inherent_risk_score: formData.likelihood * formData.impact,
      residual_risk_score: Math.floor(formData.likelihood * formData.impact * 0.6),
      status: 'identified',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {risk ? 'Edit Risk' : 'Add Risk'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300">Title</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">Category</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value as RiskCategory })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
            >
              {RISK_CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Likelihood (1-5)
              </label>
              <input
                type="number"
                min={1}
                max={5}
                value={formData.likelihood}
                onChange={(e) => setFormData({ ...formData, likelihood: parseInt(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Impact (1-5)
              </label>
              <input
                type="number"
                min={1}
                max={5}
                value={formData.impact}
                onChange={(e) => setFormData({ ...formData, impact: parseInt(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">Treatment Plan</label>
            <textarea
              value={formData.treatment_plan}
              onChange={(e) => setFormData({ ...formData, treatment_plan: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              rows={2}
              placeholder="Describe mitigation strategies..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {risk ? 'Update' : 'Create'} Risk
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
