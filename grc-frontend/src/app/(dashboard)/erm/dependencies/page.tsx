'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import {
  RiskDependency,
  RiskDependencyCreate,
  CascadeAnalysis,
  Risk,
  DependencyType,
} from '@/types';
import {
  GitBranch,
  Loader2,
  Plus,
  X,
  Trash2,
  ArrowRight,
} from 'lucide-react';

const DEPENDENCY_TYPES: { value: DependencyType; label: string; color: string }[] = [
  { value: 'causes', label: 'Causes', color: 'text-red-400' },
  { value: 'caused_by', label: 'Caused By', color: 'text-orange-400' },
  { value: 'related', label: 'Related', color: 'text-blue-400' },
  { value: 'amplifies', label: 'Amplifies', color: 'text-purple-400' },
  { value: 'mitigates', label: 'Mitigates', color: 'text-green-400' },
];

export default function DependenciesPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedRisk, setSelectedRisk] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: dependencies, isLoading } = useQuery({
    queryKey: ['erm-dependencies'],
    queryFn: async () => {
      const response = await ermApi.dependencies.getAll();
      return response.data;
    },
  });

  const { data: risks } = useQuery({
    queryKey: ['erm-risks-list'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
  });

  const { data: cascadeAnalysis } = useQuery({
    queryKey: ['erm-cascade-analysis', selectedRisk],
    queryFn: async () => {
      if (!selectedRisk) return null;
      const response = await ermApi.dependencies.getCascadeAnalysis(selectedRisk);
      return response.data;
    },
    enabled: !!selectedRisk,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ermApi.dependencies.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-dependencies'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Risk Dependencies</h2>
            <p className="text-sm text-slate-600">Visualize relationships between risks</p>
          </div>
          <select
            value={selectedRisk || ''}
            onChange={(e) => setSelectedRisk(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900"
          >
            <option value="">Select risk for cascade analysis</option>
            {risks?.map((risk) => (
              <option key={risk.id} value={risk.id}>
                {risk.title}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
        >
          <Plus className="h-4 w-4" />
          Add Dependency
        </button>
      </div>

      {cascadeAnalysis && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
          <h3 className="font-medium text-slate-900">Cascade Analysis: {cascadeAnalysis.risk_title}</h3>
          <p className="mt-1 text-sm text-slate-600">
            Total Cascade Score: <span className="font-bold text-blue-400">{cascadeAnalysis.total_cascade_score.toFixed(1)}</span>
          </p>
          
          {cascadeAnalysis.direct_impacts && cascadeAnalysis.direct_impacts.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-slate-700">Direct Impacts:</p>
              <div className="mt-2 space-y-1">
                {cascadeAnalysis.direct_impacts.map((impact) => (
                  <div key={impact.id} className="flex items-center gap-2 text-sm">
                    <ArrowRight className="h-4 w-4 text-blue-400" />
                    <span className="text-slate-700">{impact.title}</span>
                    <span className="text-slate-500">({impact.type}, strength: {impact.strength})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {dependencies && dependencies.length > 0 ? (
        <div className="space-y-3">
          {dependencies.map((dep) => {
            const typeInfo = DEPENDENCY_TYPES.find((t) => t.value === dep.dependency_type);
            return (
              <div key={dep.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-medium text-slate-900">{dep.source_risk_title || `Risk #${dep.source_risk_id}`}</p>
                    <p className="text-xs text-slate-500">Source</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <ArrowRight className={`h-5 w-5 ${typeInfo?.color || 'text-slate-600'}`} />
                    <span className={`text-xs ${typeInfo?.color || 'text-slate-600'}`}>{typeInfo?.label}</span>
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">{dep.target_risk_title || `Risk #${dep.target_risk_id}`}</p>
                    <p className="text-xs text-slate-500">Target</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm text-slate-600">Strength</p>
                    <p className="font-medium text-slate-900">{dep.strength}/5</p>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm('Delete this dependency?')) {
                        deleteMutation.mutate(dep.id);
                      }
                    }}
                    className="rounded p-1.5 text-slate-600 hover:bg-red-500/20 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-slate-200 bg-white">
          <GitBranch className="h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-slate-900">No dependencies defined</h3>
          <p className="mt-1 text-slate-600">Create relationships between risks to understand cascading effects</p>
        </div>
      )}

      {showCreateModal && (
        <DependencyModal
          risks={risks || []}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['erm-dependencies'] });
          }}
        />
      )}
    </div>
  );
}

function DependencyModal({
  risks,
  onClose,
  onSuccess,
}: {
  risks: Risk[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<Partial<RiskDependencyCreate>>({
    source_risk_id: risks[0]?.id || 0,
    target_risk_id: risks[1]?.id || risks[0]?.id || 0,
    dependency_type: 'related',
    strength: 3,
    description: '',
  });

  const createMutation = useMutation({
    mutationFn: (data: RiskDependencyCreate) => ermApi.dependencies.create(data),
    onSuccess,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.source_risk_id === formData.target_risk_id) {
      alert('Source and target risks must be different');
      return;
    }
    createMutation.mutate(formData as RiskDependencyCreate);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add Dependency</h2>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-600">Source Risk</label>
            <select
              value={formData.source_risk_id}
              onChange={(e) => setFormData({ ...formData, source_risk_id: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              required
            >
              {risks.map((risk) => (
                <option key={risk.id} value={risk.id}>
                  {risk.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-600">Dependency Type</label>
            <select
              value={formData.dependency_type}
              onChange={(e) => setFormData({ ...formData, dependency_type: e.target.value as DependencyType })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
            >
              {DEPENDENCY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-600">Target Risk</label>
            <select
              value={formData.target_risk_id}
              onChange={(e) => setFormData({ ...formData, target_risk_id: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              required
            >
              {risks.map((risk) => (
                <option key={risk.id} value={risk.id}>
                  {risk.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-600">Strength (1-5)</label>
            <input
              type="range"
              min="1"
              max="5"
              value={formData.strength}
              onChange={(e) => setFormData({ ...formData, strength: Number(e.target.value) })}
              className="mt-1 w-full"
            />
            <div className="flex justify-between text-xs text-slate-500">
              <span>Weak</span>
              <span className="font-medium text-slate-900">{formData.strength}</span>
              <span>Strong</span>
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-600">Description (optional)</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500 disabled:opacity-50"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
