'use client';

import { useEffect, useState } from 'react';
import {
  Clock,
  Save,
  Edit2,
  X,
  RotateCcw,
} from 'lucide-react';
import {
  TASK_SLA_DEFAULTS,
  TASK_SLA_LABELS,
  TASK_SLA_ORDER,
  TaskSLALevel,
  getTaskSLAConfig,
  setTaskSLAConfig,
} from '../slaConfig';

const SEVERITY_STYLES: Record<TaskSLALevel, { dot: string; pill: string; row: string }> = {
  critical: { dot: 'bg-red-500', pill: 'bg-red-50 text-red-700 border-red-200', row: 'hover:bg-red-50/40' },
  high: { dot: 'bg-orange-500', pill: 'bg-orange-50 text-orange-700 border-orange-200', row: 'hover:bg-orange-50/40' },
  medium: { dot: 'bg-yellow-500', pill: 'bg-yellow-50 text-yellow-700 border-yellow-200', row: 'hover:bg-yellow-50/40' },
  low: { dot: 'bg-blue-500', pill: 'bg-blue-50 text-blue-700 border-blue-200', row: 'hover:bg-blue-50/40' },
  info: { dot: 'bg-slate-400', pill: 'bg-slate-50 text-slate-700 border-slate-200', row: 'hover:bg-slate-50/40' },
};

export default function TasksSLAConfigPage() {
  const [config, setConfig] = useState<Record<TaskSLALevel, number>>(TASK_SLA_DEFAULTS);
  const [editing, setEditing] = useState<TaskSLALevel | null>(null);
  const [draftDays, setDraftDays] = useState<number>(0);

  useEffect(() => {
    setConfig(getTaskSLAConfig());
  }, []);

  const startEdit = (level: TaskSLALevel) => {
    setEditing(level);
    setDraftDays(config[level]);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraftDays(0);
  };

  const saveEdit = () => {
    if (!editing) return;
    const days = Math.max(1, Math.floor(draftDays || 0));
    const next = { ...config, [editing]: days };
    setConfig(next);
    setTaskSLAConfig(next);
    setEditing(null);
  };

  const resetToDefaults = () => {
    setConfig({ ...TASK_SLA_DEFAULTS });
    setTaskSLAConfig({ ...TASK_SLA_DEFAULTS });
    setEditing(null);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-slate-900">Task SLA Configuration</h2>
            <p className="text-sm text-slate-600">
              Define remediation timelines per SLA level. When creating a task, picking a level here automatically applies the configured days.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={resetToDefaults}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex-shrink-0"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to Defaults
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">SLA Level</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Remediation (Days)</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Default</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {TASK_SLA_ORDER.map((level) => {
              const style = SEVERITY_STYLES[level];
              const days = config[level];
              const isEditing = editing === level;
              const isCustom = days !== TASK_SLA_DEFAULTS[level];
              return (
                <tr key={level} className={`transition-colors ${style.row}`}>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.pill}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                      {TASK_SLA_LABELS[level]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          value={draftDays}
                          onChange={(e) => setDraftDays(Number(e.target.value))}
                          className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          autoFocus
                        />
                        <span className="text-xs text-slate-500">days</span>
                      </div>
                    ) : (
                      <div className="flex items-baseline gap-1">
                        <span className="text-sm font-semibold text-slate-900">{days}</span>
                        <span className="text-xs text-slate-500">days</span>
                        {isCustom && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-200">
                            Customized
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">{TASK_SLA_DEFAULTS[level]} days</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
                          >
                            <Save className="h-3.5 w-3.5" />
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            <X className="h-3.5 w-3.5" />
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(level)}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
        <p className="font-medium">How it works</p>
        <p className="mt-1">
          When you create a task and pick an SLA level, the matching number of days is auto-applied as the deadline window. Update any value above to override the default for your tenant.
        </p>
      </div>
    </div>
  );
}
