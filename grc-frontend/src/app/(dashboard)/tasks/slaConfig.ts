'use client';

export type TaskSLALevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface TaskSLAEntry {
  level: TaskSLALevel;
  label: string;
  days: number;
}

export const TASK_SLA_DEFAULTS: Record<TaskSLALevel, number> = {
  critical: 7,
  high: 30,
  medium: 90,
  low: 180,
  info: 365,
};

export const TASK_SLA_LABELS: Record<TaskSLALevel, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Informational',
};

export const TASK_SLA_ORDER: TaskSLALevel[] = ['critical', 'high', 'medium', 'low', 'info'];

const STORAGE_KEY = 'task-sla-config-v1';

export function getTaskSLAConfig(): Record<TaskSLALevel, number> {
  if (typeof window === 'undefined') return { ...TASK_SLA_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...TASK_SLA_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Record<TaskSLALevel, number>>;
    return { ...TASK_SLA_DEFAULTS, ...parsed };
  } catch {
    return { ...TASK_SLA_DEFAULTS };
  }
}

export function setTaskSLAConfig(config: Record<TaskSLALevel, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent('task-sla-config-changed'));
  } catch {
    /* swallow */
  }
}

export function resolveTaskSLADays(level: TaskSLALevel | string | undefined): number | undefined {
  if (!level) return undefined;
  const cfg = getTaskSLAConfig();
  const key = level as TaskSLALevel;
  return cfg[key];
}
