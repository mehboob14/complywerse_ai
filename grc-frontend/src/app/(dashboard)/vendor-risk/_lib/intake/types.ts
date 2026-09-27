// Onboarding requests (backend: vendor_risk/tpra/intake.py + onboarding.py).

export type QuestionType = 'yes_no' | 'level' | 'number' | 'date' | 'choice' | 'text';

export interface Question {
  key: string;
  type: QuestionType;
  label: string;
  required?: boolean;
  justify?: boolean;
  show_if?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface Section { key: string; title: string; questions: Question[] }

export interface Catalogue { sections: Section[]; levels: string[]; statuses: string[]; min_reason: number }

export interface Problem { key: string; message: string }

export type FactorKey = 'data_sensitivity' | 'business_criticality' | 'system_access' | 'regulatory_scope' | 'fourth_party';

export interface Preview {
  score: number;
  tier: string;
  factors: Record<FactorKey, number>;
  contributions: Record<FactorKey, number>;
  reasons?: Record<FactorKey, string[]>;
}

export interface IntakeVendor {
  id: number;
  name: string;
  website: string | null;
  owner_id: number | null;
  stakeholder_ids: number[];
  notify_emails: string;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  contract_value: number | null;
  industry: string | null;
  status: string | null;
  tier: string | null;
  lifecycle_stage: string | null;
}

export interface IntakePayload {
  vendor: IntakeVendor;
  people: Record<string, string>;
  requested_by: number | null;
  submitted_at: string | null;
  intake: { answers: Record<string, unknown>; justifications: Record<string, string> };
  intake_status: RequestStatus | null;
  problems: Problem[];
  preview: Preview;
  can_edit: boolean;
  can_review: boolean;
  next: RequestStatus[];
  updated_at: string | null;
}

export type RequestStatus = 'draft' | 'submitted' | 'in_review' | 'approved' | 'rejected';

export interface Person { id: number; name: string }

export const FACTOR_LABELS: Record<FactorKey, string> = {
  data_sensitivity: 'Data sensitivity',
  business_criticality: 'Business criticality',
  system_access: 'System access',
  regulatory_scope: 'Regulatory scope',
  fourth_party: 'Fourth-party reliance',
};

export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: 'Draft', submitted: 'Waiting for review', in_review: 'In review', approved: 'Approved', rejected: 'Turned down',
};

export const STATUS_CLS: Record<RequestStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  submitted: 'bg-amber-50 text-amber-800 border-amber-200',
  in_review: 'bg-sky-50 text-sky-700 border-sky-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
};

export const TIER_CLS: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export const errText = (e: unknown, fallback: string): string => {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && 'message' in detail) return String((detail as { message: string }).message);
  return fallback;
};
