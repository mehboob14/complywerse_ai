'use client';

// Shared BCM presentation helpers: label maps, badges, formatters, and a
// generic option picker over the /bcm/*-options endpoints. Kept in one place
// so every BCM page renders statuses/severities identically.
import { useQuery } from '@tanstack/react-query';
import { ComboBoxInput, MultiSelectDropdown, type ComboBoxOption } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { bcmApi } from '@/lib/api';

// Consistent action feedback. `fail` surfaces the backend's own validation
// message (FastAPI `detail`) so rules like "RTO must be set before Approved"
// actually reach the user instead of failing silently.
export function useBcmToast() {
  const { toast } = useToast();
  return {
    ok: (title: string, message?: string) => toast({ title, message, type: 'success' }),
    fail: (err: any, fallback: string) =>
      toast({ title: fallback, message: err?.response?.data?.detail || undefined, type: 'error' }),
    info: (title: string, message?: string) => toast({ title, message, type: 'info' }),
  };
}

// ── Label maps ───────────────────────────────────────────────────────────────
export const PLAN_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', under_review: 'Under Review', approved: 'Approved', retired: 'Retired',
};
export const DRILL_STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled', in_progress: 'In Progress', completed: 'Completed',
  under_review: 'Under Review', closed: 'Closed', cancelled: 'Cancelled', overdue: 'Overdue',
};
export const DRILL_TYPE_LABEL: Record<string, string> = {
  tabletop: 'Tabletop', simulation: 'Simulation', full_failover: 'Full Failover', call_tree: 'Call Tree',
};
export const SOURCE_TYPE_LABEL: Record<string, string> = {
  scheduled_test: 'Scheduled Test', incident_triggered: 'Incident-Triggered',
};
export const STRATEGY_TYPE_LABEL: Record<string, string> = {
  alternate_site: 'Alternate Site', remote_work: 'Remote Work', manual_workaround: 'Manual Workaround',
  vendor_failover: 'Vendor Failover', warm_site: 'Warm Site', cold_site: 'Cold Site', hot_site: 'Hot Site',
};
export const STRATEGY_STATUS_LABEL: Record<string, string> = {
  proposed: 'Proposed', approved: 'Approved', rejected: 'Rejected',
};
export const DEP_TYPE_LABEL: Record<string, string> = {
  system: 'System', vendor: 'Vendor', staff: 'Staff', facility: 'Facility',
};
export const EXTERNAL_BCP_LABEL: Record<string, string> = {
  confirmed: 'BCP Confirmed', requested: 'BCP Requested', not_provided: 'No BCP', na: 'N/A',
};
export const FREQUENCY_LABEL: Record<string, string> = {
  annual: 'Annual', semi_annual: 'Semi-Annual', quarterly: 'Quarterly',
};
export const CRITICALITY_LABEL: Record<string, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low',
};

// ── Options for <select> controls ────────────────────────────────────────────
export const DRILL_TYPE_OPTIONS = Object.entries(DRILL_TYPE_LABEL).map(([value, label]) => ({ value, label }));
export const STRATEGY_TYPE_OPTIONS = Object.entries(STRATEGY_TYPE_LABEL).map(([value, label]) => ({ value, label }));
export const DEP_TYPE_OPTIONS = Object.entries(DEP_TYPE_LABEL).map(([value, label]) => ({ value, label }));
export const EXTERNAL_BCP_OPTIONS = Object.entries(EXTERNAL_BCP_LABEL).map(([value, label]) => ({ value, label }));
export const FREQUENCY_OPTIONS = Object.entries(FREQUENCY_LABEL).map(([value, label]) => ({ value, label }));
export const CRITICALITY_OPTIONS = Object.entries(CRITICALITY_LABEL).map(([value, label]) => ({ value, label }));
export const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critical' }, { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' },
];

// ── Badge colour ramps ───────────────────────────────────────────────────────
const PLAN_STATUS_CLS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 border-slate-200',
  under_review: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  retired: 'bg-slate-100 text-slate-500 border-slate-200',
};
const DRILL_STATUS_CLS: Record<string, string> = {
  scheduled: 'bg-sky-50 text-sky-700 border-sky-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  under_review: 'bg-violet-50 text-violet-700 border-violet-200',
  closed: 'bg-slate-100 text-slate-600 border-slate-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
  overdue: 'bg-rose-50 text-rose-700 border-rose-200',
};
const SEVERITY_CLS: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const STRATEGY_STATUS_CLS: Record<string, string> = {
  proposed: 'bg-slate-100 text-slate-600 border-slate-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
};
// Issue workflow_state (derived finding status)
const ISSUE_STATE_CLS: Record<string, string> = {
  new: 'bg-sky-50 text-sky-700 border-sky-200',
  triage: 'bg-amber-50 text-amber-700 border-amber-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  resolution: 'bg-violet-50 text-violet-700 border-violet-200',
  closure_review: 'bg-violet-50 text-violet-700 border-violet-200',
  closed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
  open: 'bg-slate-100 text-slate-600 border-slate-200',
};

const pill = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize whitespace-nowrap';

export function PlanStatusBadge({ status }: { status: string }) {
  return <span className={`${pill} ${PLAN_STATUS_CLS[status] || PLAN_STATUS_CLS.draft}`}>{PLAN_STATUS_LABEL[status] || status}</span>;
}
export function DrillStatusBadge({ status }: { status: string }) {
  return <span className={`${pill} ${DRILL_STATUS_CLS[status] || DRILL_STATUS_CLS.scheduled}`}>{DRILL_STATUS_LABEL[status] || status}</span>;
}
export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`${pill} ${SEVERITY_CLS[severity] || SEVERITY_CLS.medium}`}>{severity}</span>;
}
export function StrategyStatusBadge({ status }: { status: string }) {
  return <span className={`${pill} ${STRATEGY_STATUS_CLS[status] || STRATEGY_STATUS_CLS.proposed}`}>{STRATEGY_STATUS_LABEL[status] || status}</span>;
}
export function IssueStatusBadge({ status }: { status: string }) {
  const label = status === 'open' ? 'Open' : (status || 'open').replace(/_/g, ' ');
  return <span className={`${pill} ${ISSUE_STATE_CLS[status] || ISSUE_STATE_CLS.open}`}>{label}</span>;
}

// ── Formatters ───────────────────────────────────────────────────────────────
export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '—'; }
}
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}
export function fmtHours(h?: number | null): string {
  return h == null ? '—' : `${h}h`;
}

// ── Platform-standard form controls (ComboBoxInput, as in Assets/Vulns) ───────

/** Fixed-enum single-select (Type, Source, Cadence, Severity, …). Shows the
 *  human label, stores the enum value; no free-text. */
export function BcmSelect({
  value, onChange, options, placeholder, ariaLabel, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <ComboBoxInput
      value={value}
      onChange={onChange}
      options={options as ComboBoxOption[]}
      placeholder={placeholder || 'Select…'}
      allowCustom={false}
      displayLabelInsteadOfValue
      ariaLabel={ariaLabel}
      disabled={disabled}
    />
  );
}

/** Cross-module entity picker over /bcm/*-options — the initiation point for
 *  risk / incident / document linkage. Searchable, shows the entity label,
 *  stores its id; clearing sets null. */
export function BcmEntitySelect({
  kind, value, onChange, placeholder, extraOptions,
}: {
  kind: 'documents' | 'incidents' | 'risks' | 'users';
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  /** Prepend options not returned by the endpoint (e.g. the currently-linked
   *  entity when editing, so its label always resolves). */
  extraOptions?: { value: number; label: string; subLabel?: string }[];
}) {
  const { data } = useQuery({
    queryKey: ['bcm-options', kind],
    queryFn: async () => (await bcmApi.options[kind]()).data.items as { value: number; label: string; subLabel?: string }[],
    staleTime: 60_000,
  });
  const merged = [...(extraOptions || []), ...(data || [])];
  const seen = new Set<number>();
  const options: ComboBoxOption[] = [];
  for (const o of merged) {
    if (seen.has(o.value)) continue;
    seen.add(o.value);
    options.push({ value: String(o.value), label: o.label, hint: o.subLabel || undefined });
  }
  return (
    <ComboBoxInput
      value={value != null ? String(value) : ''}
      onChange={(v) => onChange(v ? Number(v) : null)}
      options={options}
      placeholder={placeholder || 'Search…'}
      allowCustom={false}
      displayLabelInsteadOfValue
      ariaLabel={placeholder}
      emptyText={`No ${kind} found`}
    />
  );
}

/** Multi-select of IT inventory assets (grc_it_assets) for BIA asset linkage.
 *  Portal-based, so it never clips inside a modal. Stores an array of ids. */
export function BcmAssetMultiSelect({
  value, onChange, autoApply = true,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  /** true (default): commit on every toggle — right for local form state.
   *  false: batch behind an Apply button — right when each apply hits the API. */
  autoApply?: boolean;
}) {
  const { data } = useQuery({
    queryKey: ['bcm-options', 'assets'],
    queryFn: async () => (await bcmApi.options.assets()).data.items as { value: number; label: string; subLabel?: string }[],
    staleTime: 60_000,
  });
  const items = (data || []).map((o) => ({ value: String(o.value), label: o.label, subLabel: o.subLabel || undefined }));
  return (
    <MultiSelectDropdown
      title="Assets"
      items={items}
      selectedValues={(value || []).map(String)}
      onApply={(vals) => onChange(vals.map(Number))}
      multiSelect
      autoApply={autoApply}
      forceSearch
      triggerVariant="input"
      placeholder="Link inventory assets…"
      searchPlaceholder="Search assets…"
      size="md"
      showSelectionInTrigger
    />
  );
}
