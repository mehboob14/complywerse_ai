// What a monitoring alert sets off besides the two built-in rules (backend vendor_risk/tpra/alert_rules.py).
// Shared by the Alert rules settings page and the Settings index.

import apiClient from '@/lib/api';

export type AlertAction = 'notify' | 'create_task' | 'bring_forward_reassessment' | 'open_reassessment';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface AlertRule {
  id: number;
  name: string;
  /** empty: every tier */
  tiers: string[];
  /** empty: every kind of alert */
  signal_kinds: string[];
  min_severity: Severity;
  action: AlertAction;
  notify_user_ids: number[];
  notify_roles: string[];
  enabled: boolean;
  position: number;
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
}

/** What every verified alert sets off before any rule, as the other settings have it. */
export interface BuiltinRule {
  key: 'email' | 'reopen';
  action: AlertAction;
  name: string;
  enabled: boolean;
  /** where it is changed */
  settings: string;
  min_severity?: Severity;
  targets?: string[];
  reassess_on?: Record<string, Severity>;
  always?: string[];
}

export interface AlertRules {
  items: AlertRule[];
  builtin: BuiltinRule[];
  actions: Record<AlertAction, string>;
  kinds: Record<string, string>;
  severities: Severity[];
  tiers: string[];
}

/** Only the fields sent are written. */
export type AlertRuleInput = Partial<Pick<AlertRule,
  'name' | 'tiers' | 'signal_kinds' | 'min_severity' | 'action' | 'notify_user_ids' | 'notify_roles' | 'enabled'>>;

export const alertRulesApi = {
  list: () => apiClient.get<AlertRules>('/vendor-risk/alert-rules'),
  create: (data: AlertRuleInput) => apiClient.post<AlertRule>('/vendor-risk/alert-rules', data),
  update: (id: number, data: AlertRuleInput) => apiClient.put<AlertRule>(`/vendor-risk/alert-rules/${id}`, data),
  reorder: (ids: number[]) => apiClient.post<AlertRules>('/vendor-risk/alert-rules/order', { ids }),
};

export const alertRulesKey = ['tprm-alert-rules'] as const;
