// Shapes of /admin/ai-governance/* (backend: grc/modules/ai_governance/service.py)

export interface Stats {
  calls: number;
  failed: number;
  blocked: number;
  tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_hits: number;
  saved_tokens: number;
  repeat_calls: number;
  repeat_tokens: number;
  retries: number;
  with_hash: number;
  protected: number;
  entities: number;
  cost_usd: number | null;
  cost_configured: boolean;
}

export interface Overview {
  days: number;
  totals: Stats;
  truncated: boolean;
  modules: Array<Stats & { module: string; label: string }>;
  use_cases: Array<Stats & { id: string; label: string; module: string | null }>;
  recent_blocked: Array<{ id: number; at: string; use_case: string; reason: string | null; rule: string | null }>;
}

export interface UseCaseRow extends Stats {
  id: string;
  label: string;
  value: string;
  surface: string;
  trigger: string;
  trigger_label: string;
  profile: string;
  level: string;
  level_meaning: string;
  modality: string;
  records: string[];
  guarded: boolean;
  field_policy: boolean;
  cache_hours: number;
  tier: 'light' | 'standard' | 'deep';
  last_used: string | null;
}

export interface Inventory {
  days: number;
  total: number;
  unclassified: number;
  modules: Array<{ module: string; label: string; use_cases: UseCaseRow[] }>;
}

export interface CallRow {
  id: number;
  at: string | null;
  module: string;
  module_label: string;
  use_case: string | null;
  use_case_label: string;
  trigger: string | null;
  user: string;
  model: string | null;
  api: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cost_usd: number | null;
  status: string;
  error_type: string | null;
  duration_ms: number;
  attempt: number;
  operation_id: string | null;
  entities: number;
  decision: string | null;
  reason: string | null;
}

export interface GatewayReport {
  mode?: string;
  decision?: string;
  api?: string;
  use_case?: string | null;
  level?: string | null;
  registered?: boolean;
  entities?: Record<string, number>;
  tokens?: number;
  dropped?: number;
  restored?: number;
  unknown_tokens?: number;
  invented?: number;
  dictionary_terms?: number;
  blocked?: string;
  rule?: string;
  ms?: number;
}

export interface CallDetail extends CallRow {
  endpoint: string | null;
  http_method: string | null;
  requested_model: string | null;
  response_model: string | null;
  provider: string;
  pricing_version: string | null;
  gateway: GatewayReport;
  use_case_detail: { value: string; surface: string; level: string; level_meaning: string; profile: string; records: string[] } | null;
  payload: { kept: boolean; expires_at: string | null; can_reveal: boolean };
  trace: CallRow[];
}

export interface Revealed {
  request: string | null;
  response: string | null;
  truncated: boolean;
  expires_at: string;
}
