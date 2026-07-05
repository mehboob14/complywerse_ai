'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import {
  RiskDependencyCreate,
  Risk,
  DependencyType,
} from '@/types';
import {
  GitBranch,
  Loader2,
  Plus,
  Trash2,
  ArrowRight,
} from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { PageLoader } from '@/components/ui';

const DEPENDENCY_TYPES: { value: DependencyType; label: string; color: string }[] = [
  { value: 'causes', label: 'Causes', color: 'text-rose-600' },
  { value: 'caused_by', label: 'Caused By', color: 'text-orange-600' },
  { value: 'related', label: 'Related', color: 'text-primary-600' },
  { value: 'amplifies', label: 'Amplifies', color: 'text-primary-600' },
  { value: 'mitigates', label: 'Mitigates', color: 'text-emerald-600' },
];

export default function DependenciesPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedRisk, setSelectedRisk] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:risk_assessments:create');
  const canDelete = hasPermission('erm:risk_assessments:delete');

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
      <PageLoader className="h-64" />
    );
  }

  const riskOptions = (risks || []).map((r) => ({ value: String(r.id), label: r.title }));

  return (
    <div className="space-y-4 px-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold text-slate-900">Risk Dependencies</h2>
            <p className="text-xs text-slate-600">Visualize relationships between risks</p>
          </div>
          <MultiSelectDropdown
            title="Select risk for cascade analysis"
            items={riskOptions}
            selectedValues={selectedRisk ? [String(selectedRisk)] : []}
            onApply={(values) => setSelectedRisk(values[0] ? Number(values[0]) : null)}
            multiSelect={false}
            forceSearch
            triggerVariant="input"
          />
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-[#0a0a0a] hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Add Dependency
          </button>
        )}
      </div>

      {cascadeAnalysis && (
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-3 sm:p-4">
          <h3 className="text-sm font-semibold text-slate-900">Cascade Analysis: {cascadeAnalysis.risk_title}</h3>
          <p className="mt-1 text-xs text-slate-600">
            Total Cascade Score: <span className="font-bold text-primary-700">{cascadeAnalysis.total_cascade_score.toFixed(1)}</span>
          </p>

          {cascadeAnalysis.direct_impacts && cascadeAnalysis.direct_impacts.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-slate-700">Direct Impacts:</p>
              <div className="mt-2 space-y-1">
                {cascadeAnalysis.direct_impacts.map((impact) => (
                  <div key={impact.id} className="flex items-center gap-2 text-xs">
                    <ArrowRight className="h-4 w-4 text-primary-600" />
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
              <div key={dep.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{dep.source_risk_title || `Risk #${dep.source_risk_id}`}</p>
                    <p className="text-xs text-slate-500">Source</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <ArrowRight className={`h-4 w-4 ${typeInfo?.color || 'text-slate-600'}`} />
                    <span className={`text-xs ${typeInfo?.color || 'text-slate-600'}`}>{typeInfo?.label}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{dep.target_risk_title || `Risk #${dep.target_risk_id}`}</p>
                    <p className="text-xs text-slate-500">Target</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-slate-600">Strength</p>
                    <p className="text-sm font-semibold text-slate-900">{dep.strength}/5</p>
                  </div>
                  {canDelete && (
                    <button
                      onClick={() => {
                        if (confirm('Delete this dependency?')) {
                          deleteMutation.mutate(dep.id);
                        }
                      }}
                      className="rounded p-1.5 text-slate-600 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-slate-200 bg-white">
          <GitBranch className="h-10 w-10 text-slate-500" />
          <h3 className="mt-4 text-sm font-semibold text-slate-900">No dependencies defined</h3>
          <p className="mt-1 text-xs text-slate-600">Create relationships between risks to understand cascading effects</p>
        </div>
      )}

      <DependencyPanel
        isOpen={showCreateModal}
        risks={risks || []}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => {
          setShowCreateModal(false);
          queryClient.invalidateQueries({ queryKey: ['erm-dependencies'] });
        }}
      />
    </div>
  );
}

function DependencyPanel({
  isOpen,
  risks,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
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

  const riskOptions = risks.map((r) => ({ value: String(r.id), label: r.title }));
  const typeOptions = DEPENDENCY_TYPES.map((t) => ({ value: t.value, label: t.label }));

  return (
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="Add Dependency"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-slate-600 mb-1">Source Risk</label>
          <MultiSelectDropdown
            title="Source Risk"
            items={riskOptions}
            selectedValues={formData.source_risk_id ? [String(formData.source_risk_id)] : []}
            onApply={(values) => setFormData({ ...formData, source_risk_id: values[0] ? Number(values[0]) : 0 })}
            multiSelect={false}
            forceSearch
            triggerVariant="input"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-600 mb-1">Dependency Type</label>
          <MultiSelectDropdown
            title="Dependency Type"
            items={typeOptions}
            selectedValues={formData.dependency_type ? [formData.dependency_type] : []}
            onApply={(values) => setFormData({ ...formData, dependency_type: (values[0] as DependencyType) || 'related' })}
            multiSelect={false}
          />
        </div>

        <div>
          <label className="block text-sm text-slate-600 mb-1">Target Risk</label>
          <MultiSelectDropdown
            title="Target Risk"
            items={riskOptions}
            selectedValues={formData.target_risk_id ? [String(formData.target_risk_id)] : []}
            onApply={(values) => setFormData({ ...formData, target_risk_id: values[0] ? Number(values[0]) : 0 })}
            multiSelect={false}
            forceSearch
            triggerVariant="input"
          />
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
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
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
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </button>
        </div>
      </form>
    </RightSlidePanel>
  );
}
