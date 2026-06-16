'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  RiskKRI,
  RiskKRICreate,
  Risk,
  KRIMetricType,
  KRIFrequency,
  KRIThresholdDirection,
} from '@/types';
import {
  Activity,
  Loader2,
  Plus,
  TrendingDown,
  TrendingUp,
  X,
  Edit2,
  Trash2,
  Upload,
  Sparkles,
} from 'lucide-react';
import { MultiSelectDropdown, RightSlidePanel } from '@/components/ui';

const KRI_STATUS_COLORS = {
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  unknown: 'bg-slate-500',
};

export default function KRIsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMeasureModal, setShowMeasureModal] = useState<RiskKRI | null>(null);
  const [editingKRI, setEditingKRI] = useState<RiskKRI | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<{ message: string; created: number; skipped: number; errors: string[] } | null>(null);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:kris:create');
  const canEdit = hasPermission('erm:kris:edit');
  const canDelete = hasPermission('erm:kris:delete');

  const { data: kris, isLoading } = useQuery({
    queryKey: ['erm-kris'],
    queryFn: async () => {
      const response = await ermApi.kris.getAll();
      return response.data;
    },
    placeholderData: keepPreviousData,
  });

  const { data: alerts } = useQuery({
    queryKey: ['erm-kri-alerts'],
    queryFn: async () => {
      const response = await ermApi.kris.getAlerts();
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

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ermApi.kris.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-kris'] });
      queryClient.invalidateQueries({ queryKey: ['erm-kri-alerts'] });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => ermApi.kris.upload(file),
    onSuccess: (response) => {
      setUploadResult(response.data);
      setUploadFile(null);
      queryClient.invalidateQueries({ queryKey: ['erm-kris'] });
      queryClient.invalidateQueries({ queryKey: ['erm-kri-alerts'] });
    },
    onError: (error: any) => {
      setUploadResult({
        message: error?.response?.data?.detail || 'Upload failed',
        created: 0,
        skipped: 0,
        errors: [error?.response?.data?.detail || 'Unknown error'],
      });
    },
  });

  const alertCount = alerts?.length || 0;
  const redAlerts = alerts?.filter(k => k.current_status === 'red').length || 0;
  const amberAlerts = alerts?.filter(k => k.current_status === 'amber').length || 0;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold text-slate-900">Key Risk Indicators</h2>
            <p className="text-sm text-slate-600">Monitor and track risk metrics</p>
          </div>
          {alertCount > 0 && (
            <div className="flex items-center gap-2">
              {redAlerts > 0 && (
                <span className="rounded-full bg-red-500/20 px-3 py-1 text-sm text-red-400">
                  {redAlerts} Critical
                </span>
              )}
              {amberAlerts > 0 && (
                <span className="rounded-full bg-amber-500/20 px-3 py-1 text-sm text-amber-400">
                  {amberAlerts} Warning
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <button
              onClick={() => { setShowUploadModal(true); setUploadResult(null); setUploadFile(null); }}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm text-slate-900 hover:bg-slate-200"
            >
              <Upload className="h-4 w-4" />
              Upload KRIs
            </button>
          )}
          {canCreate && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
            >
              <Plus className="h-4 w-4" />
              Add KRI
            </button>
          )}
        </div>
      </div>

      {kris && kris.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {kris.map((kri) => (
            <KRICard
              key={kri.id}
              kri={kri}
              onMeasure={() => setShowMeasureModal(kri)}
              onEdit={() => setEditingKRI(kri)}
              onDelete={() => {
                if (confirm('Are you sure you want to delete this KRI?')) {
                  deleteMutation.mutate(kri.id);
                }
              }}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-slate-200 bg-white">
          <Activity className="h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-slate-900">No KRIs defined</h3>
          <p className="mt-1 text-slate-600">Create Key Risk Indicators to monitor risk metrics</p>
        </div>
      )}

      {showCreateModal && (
        <KRIModal
          risks={risks || []}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['erm-kris'] });
          }}
        />
      )}

      {editingKRI && (
        <KRIModal
          kri={editingKRI}
          risks={risks || []}
          onClose={() => setEditingKRI(null)}
          onSuccess={() => {
            setEditingKRI(null);
            queryClient.invalidateQueries({ queryKey: ['erm-kris'] });
          }}
        />
      )}

      {showMeasureModal && (
        <MeasureKRIModal
          kri={showMeasureModal}
          onClose={() => setShowMeasureModal(null)}
          onSuccess={() => {
            setShowMeasureModal(null);
            queryClient.invalidateQueries({ queryKey: ['erm-kris'] });
            queryClient.invalidateQueries({ queryKey: ['erm-kri-alerts'] });
          }}
        />
      )}

      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Upload KRIs from Excel</h3>
              <button onClick={() => setShowUploadModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>

            {uploadResult ? (
              <div className="space-y-4">
                <div className={`rounded-lg p-4 ${uploadResult.created > 0 ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                  <p className={`text-sm font-medium ${uploadResult.created > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {uploadResult.message}
                  </p>
                  {uploadResult.created > 0 && (
                    <p className="text-sm text-slate-600 mt-1">
                      {uploadResult.created} created, {uploadResult.skipped} skipped
                    </p>
                  )}
                  {uploadResult.errors.length > 0 && (
                    <div className="mt-2 max-h-32 overflow-y-auto">
                      {uploadResult.errors.map((err, i) => (
                        <p key={i} className="text-xs text-red-400">{err}</p>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowUploadModal(false)}
                    className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Upload an Excel file with KRI data. Expected columns: KRI Name, Description, Frequency, Green/Amber/Red Thresholds, Current Value, etc.
                </p>
                <div className="rounded-lg border-2 border-dashed border-gray-300 p-6 text-center">
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="kri-upload"
                  />
                  <label htmlFor="kri-upload" className="cursor-pointer">
                    <Upload className="mx-auto h-8 w-8 text-slate-500" />
                    <p className="mt-2 text-sm text-slate-600">
                      {uploadFile ? uploadFile.name : 'Click to select an Excel file'}
                    </p>
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowUploadModal(false)}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => uploadFile && uploadMutation.mutate(uploadFile)}
                    disabled={!uploadFile || uploadMutation.isPending}
                    className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {uploadMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        Upload
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KRICard({
  kri,
  onMeasure,
  onEdit,
  onDelete,
  canEdit,
  canDelete,
}: {
  kri: RiskKRI;
  onMeasure: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const statusColor = KRI_STATUS_COLORS[kri.current_status || 'unknown'];
  const trend = kri.measurements && kri.measurements.length > 1
    ? kri.measurements[kri.measurements.length - 1].value - kri.measurements[kri.measurements.length - 2].value
    : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${statusColor}`} />
          <div>
            <h3 className="font-medium text-slate-900">{kri.name}</h3>
            <p className="text-sm text-slate-600">{kri.frequency} measurement</p>
          </div>
        </div>
        <div className="flex gap-1">
          {canEdit && (
            <button
              onClick={onEdit}
              className="rounded p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <Edit2 className="h-4 w-4" />
            </button>
          )}
          {canDelete && (
            <button
              onClick={onDelete}
              className="rounded p-1.5 text-slate-600 hover:bg-red-500/20 hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-3xl font-bold text-slate-900">
              {kri.current_value !== undefined && kri.current_value !== null
                ? `${kri.current_value}${kri.unit || ''}`
                : '—'}
            </p>
            {kri.last_measured_at && (
              <p className="text-xs text-slate-500">
                Last measured: {new Date(kri.last_measured_at).toLocaleDateString()}
              </p>
            )}
          </div>
          {trend !== 0 && (
            <div className={`flex items-center gap-1 ${trend > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {trend > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              <span className="text-sm">{Math.abs(trend).toFixed(1)}</span>
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs text-slate-600">≤{kri.green_threshold}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-xs text-slate-600">≤{kri.amber_threshold}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-xs text-slate-600">&gt;{kri.amber_threshold}</span>
          </div>
        </div>
      </div>

      <button
        onClick={onMeasure}
        className="mt-4 w-full rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 hover:bg-slate-200"
      >
        Record Measurement
      </button>
    </div>
  );
}

function KRIModal({
  kri,
  risks,
  onClose,
  onSuccess,
}: {
  kri?: RiskKRI;
  risks: Risk[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<Partial<RiskKRICreate>>({
    risk_id: kri?.risk_id || (risks[0]?.id || 0),
    name: kri?.name || '',
    description: kri?.description || '',
    metric_type: kri?.metric_type || 'percentage',
    unit: kri?.unit || '%',
    green_threshold: kri?.green_threshold || 80,
    amber_threshold: kri?.amber_threshold || 50,
    threshold_direction: kri?.threshold_direction || 'higher_is_better',
    frequency: kri?.frequency || 'monthly',
  });
  const [aiSuggestionNote, setAiSuggestionNote] = useState<string | null>(null);
  const isFirstMount = useRef(true);

  const createMutation = useMutation({
    mutationFn: (data: RiskKRICreate) => ermApi.kris.create(data),
    onSuccess,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: number; updates: Partial<RiskKRICreate> }) =>
      ermApi.kris.update(data.id, data.updates),
    onSuccess,
  });

  const aiSuggestMutation = useMutation({
    mutationFn: () =>
      ermApi.kris.aiSuggestManual({
        name: formData.name || '',
        description: formData.description,
        risk_id: formData.risk_id,
      }),
    onSuccess: (response) => {
      const suggestion = response.data.suggestion as Record<string, unknown>;
      setFormData((prev) => ({
        ...prev,
        name: String(suggestion.suggested_name || prev.name || ''),
        description: String(suggestion.description || prev.description || ''),
        metric_type: (suggestion.metric_type as KRIMetricType) || prev.metric_type,
        unit: String(suggestion.unit || prev.unit || ''),
        threshold_direction: (suggestion.threshold_direction as KRIThresholdDirection) || prev.threshold_direction,
        frequency: (suggestion.frequency as KRIFrequency) || prev.frequency,
        green_threshold: (suggestion.green_threshold as number | undefined) ?? prev.green_threshold,
        amber_threshold: (suggestion.amber_threshold as number | undefined) ?? prev.amber_threshold,
      } as Partial<RiskKRICreate>));
      setAiSuggestionNote(String(suggestion.rationale) || 'AI suggestions applied');
    },
    onError: () => {
      setAiSuggestionNote('AI suggestion failed. Please try again.');
    },
  });

  // Auto-suggest when risk changes (skip initial mount)
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    if (formData.risk_id) {
      aiSuggestMutation.mutate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.risk_id]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (kri) {
      updateMutation.mutate({ id: kri.id, updates: formData });
    } else {
      createMutation.mutate(formData as RiskKRICreate);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title={kri ? 'Edit KRI' : 'Create KRI'}
    >
      <div className="px-6 py-4">
        <form id="kri-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600">Use AI to prefill KRI details for manual entry</p>
              <button
                type="button"
                onClick={() => aiSuggestMutation.mutate()}
                disabled={!formData.name || aiSuggestMutation.isPending}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-slate-800 hover:bg-gray-50 disabled:opacity-50"
              >
                {aiSuggestMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                AI Suggest
              </button>
            </div>
            {aiSuggestionNote && <p className="mt-2 text-xs text-slate-600">{aiSuggestionNote}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Risk *</label>
            <MultiSelectDropdown
              title="Risk"
              items={risks.map((risk) => ({
                value: String(risk.id),
                label: risk.title,
                subLabel: risk.risk_category,
              }))}
              selectedValues={formData.risk_id ? [String(formData.risk_id)] : []}
              onApply={(values) => setFormData({ ...formData, risk_id: values[0] ? Number(values[0]) : 0 })}
              multiSelect={false}
              triggerVariant="input"
              triggerClassName="w-full"
              forceSearch
              searchPlaceholder="Search risk by title..."
              placeholder="Select Risk"
              size="md"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Metric Type</label>
              <MultiSelectDropdown
                title="Metric Type"
                items={[
                  { value: 'percentage', label: 'Percentage' },
                  { value: 'count', label: 'Count' },
                  { value: 'currency', label: 'Currency' },
                  { value: 'ratio', label: 'Ratio' },
                  { value: 'score', label: 'Score' },
                ]}
                selectedValues={formData.metric_type ? [formData.metric_type] : []}
                onApply={(values) => setFormData({ ...formData, metric_type: (values[0] as KRIMetricType) || 'percentage' })}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                placeholder="Select Metric Type"
                size="md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Unit</label>
              <input
                type="text"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Green Threshold</label>
              <input
                type="number"
                value={formData.green_threshold}
                onChange={(e) => setFormData({ ...formData, green_threshold: Number(e.target.value) })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Amber Threshold</label>
              <input
                type="number"
                value={formData.amber_threshold}
                onChange={(e) => setFormData({ ...formData, amber_threshold: Number(e.target.value) })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Direction</label>
              <MultiSelectDropdown
                title="Direction"
                items={[
                  { value: 'higher_is_better', label: 'Higher is Better' },
                  { value: 'lower_is_better', label: 'Lower is Better' },
                ]}
                selectedValues={formData.threshold_direction ? [formData.threshold_direction] : []}
                onApply={(values) => setFormData({ ...formData, threshold_direction: (values[0] as KRIThresholdDirection) || 'higher_is_better' })}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                placeholder="Select Direction"
                size="md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Frequency</label>
              <MultiSelectDropdown
                title="Frequency"
                items={[
                  { value: 'daily', label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'quarterly', label: 'Quarterly' },
                  { value: 'annually', label: 'Annually' },
                ]}
                selectedValues={formData.frequency ? [formData.frequency] : []}
                onApply={(values) => setFormData({ ...formData, frequency: (values[0] as KRIFrequency) || 'monthly' })}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                placeholder="Select Frequency"
                size="md"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="kri-form"
              disabled={isLoading}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                kri ? 'Update' : 'Create'
              )}
            </button>
          </div>
        </form>
      </div>
    </RightSlidePanel>
  );
}

function MeasureKRIModal({
  kri,
  onClose,
  onSuccess,
}: {
  kri: RiskKRI;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [value, setValue] = useState<number>(kri.current_value || 0);
  const [notes, setNotes] = useState('');

  const measureMutation = useMutation({
    mutationFn: (data: { value: number; notes?: string }) => ermApi.kris.measure(kri.id, data),
    onSuccess,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    measureMutation.mutate({ value, notes: notes || undefined });
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      width="w-full max-w-md"
      title="Record Measurement"
      subtitle={kri.name}
    >
      <div className="px-6 py-4">
        <form id="measure-kri-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Value *</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
              {kri.unit && <span className="text-slate-600">{kri.unit}</span>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="measure-kri-form"
              disabled={measureMutation.isPending}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {measureMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Record'
              )}
            </button>
          </div>
        </form>
      </div>
    </RightSlidePanel>
  );
}
