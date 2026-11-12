'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ermApi, tenantApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import NcaKpiSection from '@/components/risks/NcaKpiSection';
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
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
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
import { MultiSelectDropdown, RightSlidePanel, PageLoader } from '@/components/ui';
import { dueText, sortIndicators, thresholdLabels, thresholdLegend, trendOf, type ThresholdChange } from './_kriModel';
import { KRI_STATUS_COLORS, ValuesDue, ValuesToCheck, errorText } from './_KriValueTabs';
import { NeedsRisk, NeedsRiskSummary, ThresholdChangeNotice } from './_KriChanges';

/** The API also sends these; the shared type does not list them yet. */
type KRIRow = RiskKRI & {
  kind?: string;
  status?: string | null;          // 'draft' until someone other than its creator approves it
  created_by?: number | null;
  data_provider_id?: number | null;
  reviewer_id?: number | null;
  next_due_date?: string | null;
  is_live?: boolean;               // fed from a platform metric: no manual value to submit
  threshold_change?: ThresholdChange | null;   // a threshold change waiting for (or given) a second person's decision
};
/** What the Submit value panel needs (a card's KRI, or a row of Values due). */
type MeasureTarget = Pick<RiskKRI, 'id' | 'name' | 'unit' | 'current_value'>;
/** What the form edits: the shared create type plus who provides and checks the value, and when it is due. */
type KRIForm = Partial<RiskKRICreate> & { data_provider_id?: number; reviewer_id?: number; next_due_date?: string };
interface TenantUserOption { id: number; display_name: string; email?: string }
type KRITab = 'indicators' | 'check' | 'due';
const TABS: { key: KRITab; label: string; icon: typeof Activity }[] = [
  { key: 'indicators', label: 'Indicators', icon: Activity },
  { key: 'check', label: 'Values to check', icon: ClipboardCheck },
  { key: 'due', label: 'Values due', icon: CalendarClock },
];

const INVALIDATE = [['erm-kris'], ['erm-kri-alerts'], ['erm-kri-pending'], ['erm-kri-due'], ['erm-kri-trend']];

export default function KRIsPage() {
  // Register-type toggle: 'standard' shows the existing platform KRIs;
  // 'nca' shows the NCA Saudi KPI Report Template register.
  const [registerType, setRegisterType] = useState<'standard' | 'nca'>('standard');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMeasureModal, setShowMeasureModal] = useState<MeasureTarget | null>(null);
  const [editingKRI, setEditingKRI] = useState<KRIRow | null>(null);
  const [tab, setTab] = useState<KRITab>('indicators');
  const [notice, setNotice] = useState<string | null>(null);
  // A reminder links to ?tab=due; read once on mount (no Suspense boundary needed for useSearchParams).
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('tab');
    if (asked === 'due' || asked === 'check') setTab(asked);
  }, []);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<{ message: string; created: number; skipped: number; errors: string[] } | null>(null);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:kris:create');
  const canEdit = hasPermission('erm:kris:edit');
  const canDelete = hasPermission('erm:kris:delete');

  // KPIs share the table; they are managed on the Governance KPI pages, not here.
  const { data: kris, isLoading } = useQuery({
    queryKey: ['erm-kris'],
    queryFn: async () => {
      const response = await ermApi.kris.getAll({ kind: 'kri' });
      return response.data as KRIRow[];
    },
    placeholderData: keepPreviousData,
  });

  const { data: alerts } = useQuery({
    queryKey: ['erm-kri-alerts'],
    queryFn: async () => {
      const response = await ermApi.kris.getAlerts({ kind: 'kri' });
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

  const { data: tenantUsers } = useQuery({
    queryKey: ['erm-kri-tenant-users'],
    queryFn: async () => ((await tenantApi.getTenantUsers()).data || []) as TenantUserOption[],
  });
  const nameOf = (id?: number | null) => (id ? tenantUsers?.find((u) => u.id === id)?.display_name || `User #${id}` : null);

  const { data: pending } = useQuery({
    queryKey: ['erm-kri-pending'],
    queryFn: async () => (await ermApi.kris.pendingReviews()).data.items.filter((i) => (i.kind || 'kri') === 'kri'),
  });

  const { data: due } = useQuery({
    queryKey: ['erm-kri-due'],
    queryFn: async () => (await ermApi.kris.due({ kind: 'kri' })).data.due,
  });

  const refresh = () => INVALIDATE.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ermApi.kris.delete(id),
    onSuccess: refresh,
  });

  const remindMutation = useMutation({
    mutationFn: () => ermApi.kris.sendReminders(),
    onSuccess: (res) => setNotice(res.data.reminded
      ? `Reminders sent for ${res.data.reminded} overdue value${res.data.reminded === 1 ? '' : 's'}.`
      : 'No overdue values to chase.'),
    onError: (error) => setNotice(errorText(error, 'Could not send reminders')),
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
      <PageLoader className="h-64" />
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      {/* Register-type toggle: pick standard platform KRIs vs NCA Saudi KPI Report Template */}
      <div className="flex items-center justify-between flex-wrap gap-3 -mb-2">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Key Risk Indicators</h1>
          <p className="text-sm text-slate-600">Thresholds, values checked by a second person, and escalation when they breach</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">Register Type:</span>
          <select
            value={registerType}
            onChange={(e) => setRegisterType(e.target.value as 'standard' | 'nca')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="standard">Standard KRIs</option>
            <option value="nca">NCA KPI Report Template</option>
          </select>
        </div>
      </div>

      {registerType === 'nca' ? (
        <NcaKpiSection />
      ) : (
      <>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          {alertCount > 0 && (
            <div className="flex items-center gap-2">
              {redAlerts > 0 && (
                <span className="rounded-full bg-rose-50 px-3 py-1 text-sm text-rose-700">
                  {redAlerts} Critical
                </span>
              )}
              {amberAlerts > 0 && (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-700">
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
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-[#0a0a0a] hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" />
              Add KRI
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white px-3">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map(({ key, label, icon: Icon }) => {
            const count = key === 'check' ? pending?.length : key === 'due' ? due?.length : undefined;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
                {!!count && (
                  <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3 text-xs text-blue-800">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-blue-700 hover:text-blue-900">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {tab === 'indicators' && kris && <NeedsRiskSummary count={kris.filter((k) => !k.risk_id).length} />}
      {tab === 'indicators' && (kris && kris.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sortIndicators(kris).map((kri) => (
            <KRICard
              key={kri.id}
              kri={kri}
              nameOf={nameOf}
              onMeasure={() => setShowMeasureModal(kri)}
              onEdit={() => setEditingKRI(kri)}
              onDelete={() => {
                if (confirm('Are you sure you want to delete this KRI?')) {
                  deleteMutation.mutate(kri.id);
                }
              }}
              onChanged={refresh}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-slate-200 bg-white">
          <Activity className="h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-slate-900">No indicators yet</h3>
          <p className="mt-1 text-slate-600">Add a KRI with its owner, data provider, checker and thresholds</p>
        </div>
      ))}

      {tab === 'check' && (
        <ValuesToCheck items={pending || []} nameOf={nameOf} canEdit={canEdit} onChanged={refresh} />
      )}

      {tab === 'due' && (
        <ValuesDue
          items={due || []}
          nameOf={nameOf}
          canEdit={canEdit}
          onSubmit={(d) => setShowMeasureModal({ id: d.id, name: d.name, unit: d.unit ?? undefined })}
          onRemind={() => remindMutation.mutate()}
          reminding={remindMutation.isPending}
        />
      )}

      {showCreateModal && (
        <KRIModal
          risks={risks || []}
          users={tenantUsers || []}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            setNotice('KRI saved as a draft. Someone other than you approves the indicator and its thresholds to start monitoring it.');
            refresh();
          }}
        />
      )}

      {editingKRI && (
        <KRIModal
          kri={editingKRI}
          risks={risks || []}
          users={tenantUsers || []}
          onClose={() => setEditingKRI(null)}
          onSuccess={() => {
            setEditingKRI(null);
            refresh();
          }}
        />
      )}

      {showMeasureModal && (
        <MeasureKRIModal
          kri={showMeasureModal}
          onClose={() => setShowMeasureModal(null)}
          onSuccess={(reviewStatus) => {
            setShowMeasureModal(null);
            if (reviewStatus === 'submitted') {
              setNotice('Value sent for checking. It is published, and escalated if it breaches, once someone else approves it.');
            }
            refresh();
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
                <div className={`rounded-lg p-4 ${uploadResult.created > 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200'}`}>
                  <p className={`text-sm font-medium ${uploadResult.created > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
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
                        <p key={i} className="text-xs text-rose-600">{err}</p>
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
                  Uploaded KRIs arrive as drafts for someone other than you to approve, and their current values wait for a checker.
                </p>
                <div className="rounded-lg border-2 border-dashed border-slate-300 p-6 text-center">
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
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
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
      </>
      )}
    </div>
  );
}

function KRICard({
  kri,
  nameOf,
  onMeasure,
  onEdit,
  onDelete,
  onChanged,
  canEdit,
  canDelete,
}: {
  kri: KRIRow;
  nameOf: (id?: number | null) => string | null;
  onMeasure: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const statusColor = KRI_STATUS_COLORS[kri.current_status || 'unknown'];
  const isDraft = kri.status === 'draft';
  const [approveError, setApproveError] = useState<string | null>(null);
  const activateMutation = useMutation({
    mutationFn: () => ermApi.kris.activate(kri.id),
    onSuccess: () => { setApproveError(null); onChanged(); },
    onError: (error) => setApproveError(errorText(error, 'Could not approve this KRI')),
  });
  const due = dueText(kri.next_due_date);
  // The list carries no history: the approved measurements come from /trend (oldest first).
  const { data: history } = useQuery({
    queryKey: ['erm-kri-trend', kri.id, kri.last_measured_at],
    queryFn: async () => (await ermApi.kris.getTrend(kri.id)).data,
  });
  const trend = trendOf((history || []).map((m) => m.value), kri.threshold_direction);
  const legend = thresholdLegend(kri.threshold_direction, kri.green_threshold, kri.amber_threshold);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${statusColor}`} />
          <div>
            <h3 className="font-medium text-slate-900">{kri.name}</h3>
            <p className="text-sm text-slate-600">{kri.frequency} measurement</p>
            {isDraft && (
              <span className="mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border bg-slate-100 text-slate-600 border-slate-200">
                Draft · awaiting approval
              </span>
            )}
            {!kri.risk_id && <div><NeedsRisk onLink={onEdit} canEdit={!!canEdit} /></div>}
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
              className="rounded p-1.5 text-slate-600 hover:bg-rose-50 hover:text-rose-600"
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
          {trend && (
            <div className={`flex items-center gap-1 ${trend.better ? 'text-emerald-600' : 'text-rose-600'}`}>
              {trend.delta > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              <span className="text-sm">{Math.abs(trend.delta).toFixed(1)}</span>
            </div>
          )}
        </div>

        {legend && (
          <div className="mt-4 flex gap-2">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-xs text-slate-600">{legend[0]}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-xs text-slate-600">{legend[1]}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-rose-500" />
              <span className="text-xs text-slate-600">{legend[2]}</span>
            </div>
          </div>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs">
        <div>
          <dt className="text-slate-500">Owner</dt>
          <dd className="truncate text-slate-800">{nameOf(kri.owner_id) || '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Data provider</dt>
          <dd className="truncate text-slate-800">{nameOf(kri.data_provider_id) || nameOf(kri.owner_id) || '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Next due</dt>
          <dd className={due?.startsWith('Overdue') ? 'text-rose-600' : 'text-slate-800'}>
            {kri.next_due_date ? new Date(kri.next_due_date).toLocaleDateString() : '—'}
          </dd>
        </div>
      </dl>

      <ThresholdChangeNotice kri={kri} canEdit={!!canEdit} nameOf={nameOf} onChanged={onChanged} />

      {isDraft ? (
        canEdit && (
          <div className="mt-4">
            <button
              onClick={() => activateMutation.mutate()}
              disabled={activateMutation.isPending}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {activateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Approve indicator and thresholds
            </button>
            {approveError && <p className="mt-2 text-xs text-rose-700">{approveError}</p>}
          </div>
        )
      ) : canEdit && !kri.is_live && (
        <button
          onClick={onMeasure}
          className="mt-4 w-full rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 hover:bg-slate-200"
        >
          Submit value
        </button>
      )}
    </div>
  );
}

function KRIModal({
  kri,
  risks,
  users,
  onClose,
  onSuccess,
}: {
  kri?: KRIRow;
  risks: Risk[];
  users: TenantUserOption[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const userItems = users.map((u) => ({ value: String(u.id), label: u.display_name, subLabel: u.email }));
  // Starting values fill a new KRI only; an existing one opens with what it holds (a 0 threshold stays 0).
  const [formData, setFormData] = useState<KRIForm>({
    owner_id: kri?.owner_id ?? undefined,
    data_provider_id: kri?.data_provider_id ?? undefined,
    reviewer_id: kri?.reviewer_id ?? undefined,
    next_due_date: kri?.next_due_date ? kri.next_due_date.slice(0, 10) : undefined,
    risk_id: kri?.risk_id || undefined,
    name: kri?.name ?? '',
    description: kri?.description ?? '',
    metric_type: kri?.metric_type ?? 'percentage',
    unit: kri ? kri.unit ?? '' : '%',
    green_threshold: kri ? kri.green_threshold ?? undefined : 80,
    amber_threshold: kri ? kri.amber_threshold ?? undefined : 50,
    threshold_direction: kri?.threshold_direction ?? 'higher_is_better',
    frequency: kri?.frequency ?? 'monthly',
    kind: kri?.kind ?? 'kri',
  });
  const [aiSuggestionNote, setAiSuggestionNote] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const isFirstMount = useRef(true);

  const createMutation = useMutation({
    mutationFn: (data: RiskKRICreate) => ermApi.kris.create(data),
    onSuccess,
    onError: (error: any) => {
      const d = error?.response?.data?.detail;
      setFormError(typeof d === 'string' ? d : error?.message || 'Could not create KRI');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: number; updates: Partial<RiskKRICreate> }) =>
      ermApi.kris.update(data.id, data.updates),
    onSuccess,
    onError: (error: any) => {
      const d = error?.response?.data?.detail;
      setFormError(typeof d === 'string' ? d : error?.message || 'Could not update KRI');
    },
  });

  const aiSuggestMutation = useMutation({
    mutationFn: () =>
      ermApi.kris.aiSuggestManual({
        name: formData.name || '',
        description: formData.description,
        risk_id: formData.risk_id,
      }),
    onSuccess: (response) => {
      const suggestion = response.data.suggestion;
      setFormData((prev) => ({
        ...prev,
        name: suggestion.suggested_name || prev.name || '',
        description: suggestion.description || prev.description || '',
        metric_type: (suggestion.metric_type as KRIMetricType) || prev.metric_type,
        unit: suggestion.unit || prev.unit || '',
        threshold_direction: (suggestion.threshold_direction as KRIThresholdDirection) || prev.threshold_direction,
        frequency: (suggestion.frequency as KRIFrequency) || prev.frequency,
        green_threshold: suggestion.green_threshold ?? prev.green_threshold,
        amber_threshold: suggestion.amber_threshold ?? prev.amber_threshold,
      }));
      setAiSuggestionNote(suggestion.rationale || 'AI suggestions applied');
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
    setFormError(null);
    if (!formData.name?.trim()) {
      setFormError('Name is required');
      return;
    }
    const payload = {
      ...formData,
      name: formData.name.trim(),
      risk_id: formData.risk_id && formData.risk_id > 0 ? formData.risk_id : undefined,
      kind: formData.kind || 'kri',
      // A day goes as midnight; left blank, the server sets it one period from now.
      next_due_date: formData.next_due_date ? `${formData.next_due_date}T00:00:00` : undefined,
    } as RiskKRICreate;
    if (kri) {
      updateMutation.mutate({ id: kri.id, updates: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;
  const [greenLabel, amberLabel] = thresholdLabels(formData.threshold_direction);
  const pickUser = (field: 'owner_id' | 'data_provider_id' | 'reviewer_id', title: string, placeholder: string) => (
    <MultiSelectDropdown
      title={title}
      items={userItems}
      selectedValues={formData[field] ? [String(formData[field])] : []}
      onApply={(values) => setFormData({ ...formData, [field]: values[0] ? Number(values[0]) : undefined })}
      multiSelect={false}
      triggerVariant="input"
      triggerClassName="w-full"
      forceSearch
      searchPlaceholder="Search users"
      placeholder={placeholder}
      size="md"
    />
  );

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title={kri ? 'Edit KRI' : 'Create KRI'}
    >
      <div className="px-6 py-4">
        <form id="kri-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600">Use AI to prefill KRI details for manual entry</p>
              <button
                type="button"
                onClick={() => aiSuggestMutation.mutate()}
                disabled={!formData.name || aiSuggestMutation.isPending}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {aiSuggestMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                AI Suggest
              </button>
            </div>
            {aiSuggestionNote && <p className="mt-2 text-xs text-slate-600">{aiSuggestionNote}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Linked risk <span className="text-xs font-normal text-slate-400">(optional)</span>
            </label>
            <MultiSelectDropdown
              title="Risk"
              items={risks.map((risk) => ({
                value: String(risk.id),
                label: risk.title,
                subLabel: risk.risk_category,
              }))}
              selectedValues={formData.risk_id ? [String(formData.risk_id)] : []}
              onApply={(values) =>
                setFormData({
                  ...formData,
                  risk_id: values[0] ? Number(values[0]) : undefined,
                })
              }
              multiSelect={false}
              triggerVariant="input"
              triggerClassName="w-full"
              forceSearch
              searchPlaceholder="Search risk by title..."
              placeholder="No linked risk (standalone KRI)"
              size="md"
            />
            <p className="mt-1 text-xs text-slate-500">
              Leave empty to create a governance-level KRI not tied to a single risk.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Metric Type</label>
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Unit</label>
              <input
                type="text"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{greenLabel}</label>
              <input
                type="number"
                value={formData.green_threshold ?? ''}
                onChange={(e) => setFormData({ ...formData, green_threshold: e.target.value === '' ? undefined : Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{amberLabel}</label>
              <input
                type="number"
                value={formData.amber_threshold ?? ''}
                onChange={(e) => setFormData({ ...formData, amber_threshold: e.target.value === '' ? undefined : Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Direction</label>
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Frequency</label>
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">KRI owner</label>
              {pickUser('owner_id', 'KRI owner', 'Acts when it turns amber or red')}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Data provider</label>
              {pickUser('data_provider_id', 'Data provider', 'Submits each value')}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Checker</label>
              {pickUser('reviewer_id', 'Checker', 'Checks each value')}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Next value due</label>
              <input
                type="date"
                value={formData.next_due_date ?? ''}
                onChange={(e) => setFormData({ ...formData, next_due_date: e.target.value || undefined })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <p className="mt-1 text-xs text-slate-500">Leave blank: one period from today.</p>
            </div>
          </div>

          {!kri && (
            <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3 text-xs text-blue-800">
              A new KRI is a draft until someone other than you approves the indicator and its thresholds. Each value
              is then checked by a second person before it is published.
            </div>
          )}

          {formError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
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
                kri ? 'Update' : 'Submit for approval'
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
  kri: MeasureTarget;
  onClose: () => void;
  onSuccess: (reviewStatus?: string) => void;
}) {
  const [value, setValue] = useState<number>(kri.current_value || 0);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const measureMutation = useMutation({
    mutationFn: (data: { value: number; notes?: string }) => ermApi.kris.measure(kri.id, data),
    onSuccess: (res) => onSuccess((res.data as { review_status?: string }).review_status),
    onError: (e) => setError(errorText(e, 'Could not submit the value')),
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
      title="Submit value"
      subtitle={kri.name}
    >
      <div className="px-6 py-4">
        <form id="measure-kri-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Value *</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
              {kri.unit && <span className="text-slate-600">{kri.unit}</span>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Source and notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Where the figure comes from (report, system export) and anything the checker should know"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              rows={2}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
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
                'Submit for checking'
              )}
            </button>
          </div>
        </form>
      </div>
    </RightSlidePanel>
  );
}
