// Basel loss events (Basel Framework OPE25) on the incident record: taxonomy, amounts, validation.
// The taxonomy mirrors backend/grc/modules/erm/loss_taxonomy.py; lossEvents.test.ts reads that file to keep them equal.
import type { IncidentDashboard, RiskIncident } from '@/types';

export interface Option {
  value: string;
  label: string;
}

export const EVENT_TYPES: Option[] = [
  { value: 'internal_fraud', label: 'Internal fraud' },
  { value: 'external_fraud', label: 'External fraud' },
  { value: 'employment_practices', label: 'Employment practices and workplace safety' },
  { value: 'clients_products', label: 'Clients, products and business practices' },
  { value: 'physical_assets', label: 'Damage to physical assets' },
  { value: 'business_disruption', label: 'Business disruption and system failures' },
  { value: 'execution_delivery', label: 'Execution, delivery and process management' },
];

export const BUSINESS_LINES: Option[] = [
  { value: 'corporate_finance', label: 'Corporate finance' },
  { value: 'trading_sales', label: 'Trading and sales' },
  { value: 'retail_banking', label: 'Retail banking' },
  { value: 'commercial_banking', label: 'Commercial banking' },
  { value: 'payment_settlement', label: 'Payment and settlement' },
  { value: 'agency_services', label: 'Agency services' },
  { value: 'asset_management', label: 'Asset management' },
  { value: 'retail_brokerage', label: 'Retail brokerage' },
];

export type BoundaryType = 'none' | 'credit' | 'market';

export const BOUNDARY_TYPES: { value: BoundaryType; label: string }[] = [
  { value: 'none', label: 'Operational only' },
  { value: 'credit', label: 'Credit risk boundary' },
  { value: 'market', label: 'Market risk boundary' },
];

export type ValidationStatus = 'pending' | 'validated' | 'returned';

export const VALIDATION_STATUSES: { value: ValidationStatus; label: string; color: string }[] = [
  { value: 'pending', label: 'Awaiting validation', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'validated', label: 'Validated', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'returned', label: 'Returned', color: 'bg-orange-50 text-orange-700 border-orange-200' },
];

/** What the loss-event form edits. net_loss is computed by the server on save. */
export interface LossFields {
  discovered_date?: string | null;
  event_type?: string | null;
  event_type_l2?: string | null;
  business_line?: string | null;
  gross_loss?: number | null;
  recoveries?: number | null;
  currency?: string | null;
  accounting_date?: string | null;
  is_near_miss?: boolean | null;
  boundary_type?: BoundaryType | null;
}

export type LossEvent = RiskIncident & LossFields & {
  net_loss?: number | null;
  validation_status?: ValidationStatus;
  validated_by?: number | null;
  validated_at?: string | null;
  validation_note?: string | null;
};

export interface CurrencyAmount {
  currency: string | null;
  net_loss: number;
}

export type LossDashboard = IncidentDashboard & {
  net_loss_this_quarter?: CurrencyAmount[];
  net_loss_last_quarter?: CurrencyAmount[];
  net_loss_by_event_type?: Array<CurrencyAmount & { event_type: string | null }>;
  near_misses?: number;
  awaiting_validation?: number;
};

export function labelOf(options: Option[], key: string | null | undefined): string {
  return options.find((o) => o.value === key)?.label ?? key ?? '';
}

/** Gross loss less recoveries, never below zero; null while there is no gross loss. Same rule as the server. */
export function netLoss(gross: number | null | undefined, recoveries: number | null | undefined): number | null {
  if (gross === null || gross === undefined) return null;
  return Math.max(0, Math.round((gross - (recoveries ?? 0)) * 100) / 100);
}

/** An amount in its own currency ("USD 1,200.5"); without a currency (records from before loss events) the bare number. */
export function formatMoney(amount: number, currency: string | null | undefined): string {
  const n = amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return currency ? `${currency} ${n}` : n;
}

/** The form's loss fields as the API takes them: blanks are null (an empty string would read as a change and re-open validation). */
export function lossPayload(f: LossFields): LossFields {
  const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    discovered_date: blank(f.discovered_date) ?? undefined,
    event_type: blank(f.event_type),
    event_type_l2: blank(f.event_type_l2),
    business_line: blank(f.business_line),
    gross_loss: f.gross_loss ?? null,
    recoveries: f.recoveries ?? null,
    currency: blank(f.currency)?.toUpperCase() ?? null,
    accounting_date: blank(f.accounting_date),
    is_near_miss: !!f.is_near_miss,
    boundary_type: f.boundary_type || 'none',
  };
}
