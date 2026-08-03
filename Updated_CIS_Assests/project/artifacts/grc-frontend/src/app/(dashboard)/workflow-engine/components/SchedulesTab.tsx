'use client';

import { Calendar, Copy, Globe, Plus, Trash2, ToggleLeft, ToggleRight, Webhook, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { workflowEngineApi } from '@/lib/api';
import { WorkflowDefinition } from './types';

type Schedule = {
  id: number;
  workflow_definition_id: number;
  schedule_type: string;
  cron_expression?: string;
  interval_minutes?: number;
  next_run_at?: string;
  last_run_at?: string;
  is_active: boolean;
  payload?: Record<string, unknown>;
  workflow_name?: string;
};

type WebhookEndpoint = {
  id: number;
  name: string;
  event_name: string;
  token: string;
  is_active: boolean;
  created_at: string;
  last_triggered_at?: string;
};

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

type Tab = 'schedules' | 'webhooks';

export function SchedulesTab({ definitions }: { definitions: WorkflowDefinition[] }) {
  const [tab, setTab] = useState<Tab>('schedules');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);
  const [showCreateWebhook, setShowCreateWebhook] = useState(false);

  // New schedule form state
  const [newSchedDef, setNewSchedDef] = useState<string>('');
  const [newSchedCron, setNewSchedCron] = useState('0 9 * * 1');
  const [newSchedLabel, setNewSchedLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // New webhook form state
  const [newWebhookName, setNewWebhookName] = useState('');
  const [newWebhookEvent, setNewWebhookEvent] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);

  const CRON_PRESETS = [
    { label: 'Daily 9 AM', value: '0 9 * * *' },
    { label: 'Every Monday 9 AM', value: '0 9 * * 1' },
    { label: 'Monthly (1st)', value: '0 9 1 * *' },
    { label: 'Quarterly', value: '0 9 1 1,4,7,10 *' },
    { label: 'Annually', value: '0 9 1 1 *' },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [schedRes, webhookRes] = await Promise.all([
        workflowEngineApi.integrations.listSchedules(),
        workflowEngineApi.integrations.listWebhooks(),
      ]);
      setSchedules(schedRes.data || []);
      setWebhooks(webhookRes.data || []);
    } catch {
      setSchedules([]);
      setWebhooks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createSchedule = async () => {
    if (!newSchedDef) return;
    setSaving(true);
    try {
      await workflowEngineApi.integrations.createSchedule({
        workflow_definition_id: Number(newSchedDef),
        schedule_type: 'cron',
        cron_expression: newSchedCron,
        label: newSchedLabel,
        is_active: true,
      });
      setShowCreateSchedule(false);
      setNewSchedDef('');
      setNewSchedCron('0 9 * * 1');
      setNewSchedLabel('');
      await load();
    } catch (e) {
      console.error('Create schedule error:', e);
    } finally {
      setSaving(false);
    }
  };

  const createWebhook = async () => {
    if (!newWebhookName || !newWebhookEvent) return;
    setSaving(true);
    try {
      const res = await workflowEngineApi.integrations.createWebhook({
        name: newWebhookName,
        event_name: newWebhookEvent,
        is_active: true,
      });
      setNewToken(res.data?.token || null);
      setNewWebhookName('');
      setNewWebhookEvent('');
      await load();
    } catch (e) {
      console.error('Create webhook error:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tabs */}
      <div className="flex items-center gap-0 px-5 border-b border-gray-200 bg-white shrink-0">
        {([
          { key: 'schedules' as Tab, label: 'Schedules', icon: Calendar },
          { key: 'webhooks' as Tab, label: 'Webhooks', icon: Webhook },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              tab === t.key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon size={12} />
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => tab === 'schedules' ? setShowCreateSchedule(true) : setShowCreateWebhook(true)}
          className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 px-3 py-2"
        >
          <Plus size={13} />
          New {tab === 'schedules' ? 'Schedule' : 'Webhook'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {/* Token display after creation */}
        {newToken && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-green-800 mb-1">Webhook Created!</p>
                <p className="text-[11px] text-green-700 mb-2">Copy this token now — it will not be shown again.</p>
                <div className="flex items-center gap-2 bg-white border border-green-300 rounded-lg px-3 py-1.5">
                  <code className="text-xs font-mono text-gray-800 break-all">{newToken}</code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(newToken); }}
                    className="shrink-0 p-1 hover:bg-green-100 rounded"
                    title="Copy token"
                  >
                    <Copy size={12} className="text-green-700" />
                  </button>
                </div>
              </div>
              <button onClick={() => setNewToken(null)} className="text-green-600 hover:text-green-800">
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {tab === 'schedules' && (
          <>
            {/* Create form */}
            {showCreateSchedule && (
              <div className="mb-4 bg-white border border-blue-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-gray-800">Create Scheduled Run</h3>
                  <button onClick={() => setShowCreateSchedule(false)} className="text-gray-400 hover:text-gray-600">
                    <X size={14} />
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Workflow</label>
                    <select
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      value={newSchedDef}
                      onChange={(e) => setNewSchedDef(e.target.value)}
                    >
                      <option value="">Select workflow...</option>
                      {definitions.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Frequency Preset</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {CRON_PRESETS.map((p) => (
                        <button
                          key={p.value}
                          onClick={() => setNewSchedCron(p.value)}
                          className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                            newSchedCron === p.value
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Cron Expression</label>
                    <input
                      className="w-full text-xs font-mono border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      value={newSchedCron}
                      onChange={(e) => setNewSchedCron(e.target.value)}
                      placeholder="0 9 * * 1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Label (optional)</label>
                    <input
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      value={newSchedLabel}
                      onChange={(e) => setNewSchedLabel(e.target.value)}
                      placeholder="e.g. Weekly Risk Review"
                    />
                  </div>
                  <button
                    onClick={createSchedule}
                    disabled={saving || !newSchedDef}
                    className="w-full text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Creating...' : 'Create Schedule'}
                  </button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="text-center py-16 text-xs text-gray-400">Loading schedules...</div>
            ) : schedules.length === 0 ? (
              <div className="text-center py-16 text-xs text-gray-400">
                <Calendar size={32} className="mx-auto mb-3 text-gray-200" />
                <p className="font-medium">No schedules yet</p>
                <p className="text-gray-300 mt-1">Create a schedule to run workflows automatically</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Workflow</th>
                      <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Schedule</th>
                      <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Next Run</th>
                      <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Last Run</th>
                      <th className="text-center px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((s) => (
                      <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-gray-800">{s.workflow_name || `Workflow #${s.workflow_definition_id}`}</td>
                        <td className="px-5 py-3 font-mono text-gray-600 text-[10px]">{s.cron_expression || `Every ${s.interval_minutes}m`}</td>
                        <td className="px-5 py-3 text-gray-500">{formatDate(s.next_run_at)}</td>
                        <td className="px-5 py-3 text-gray-500">{formatDate(s.last_run_at)}</td>
                        <td className="px-5 py-3 text-center">
                          {s.is_active
                            ? <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">Active</span>
                            : <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-semibold">Paused</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === 'webhooks' && (
          <>
            {/* Create form */}
            {showCreateWebhook && (
              <div className="mb-4 bg-white border border-blue-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-gray-800">Create Webhook Endpoint</h3>
                  <button onClick={() => setShowCreateWebhook(false)} className="text-gray-400 hover:text-gray-600">
                    <X size={14} />
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Name</label>
                    <input
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      value={newWebhookName}
                      onChange={(e) => setNewWebhookName(e.target.value)}
                      placeholder="e.g. GitHub Security Alert"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Trigger Event</label>
                    <input
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      value={newWebhookEvent}
                      onChange={(e) => setNewWebhookEvent(e.target.value)}
                      placeholder="e.g. vulnerability.detected"
                    />
                  </div>
                  <button
                    onClick={createWebhook}
                    disabled={saving || !newWebhookName || !newWebhookEvent}
                    className="w-full text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Creating...' : 'Create Webhook'}
                  </button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="text-center py-16 text-xs text-gray-400">Loading webhooks...</div>
            ) : webhooks.length === 0 ? (
              <div className="text-center py-16 text-xs text-gray-400">
                <Globe size={32} className="mx-auto mb-3 text-gray-200" />
                <p className="font-medium">No webhooks yet</p>
                <p className="text-gray-300 mt-1">Create a webhook to trigger workflows from external systems</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                      <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Event</th>
                      <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Token</th>
                      <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Last Triggered</th>
                      <th className="text-center px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhooks.map((w) => (
                      <tr key={w.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-gray-800">{w.name}</td>
                        <td className="px-5 py-3 font-mono text-gray-600 text-[10px]">{w.event_name}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] text-gray-500">{w.token.substring(0, 16)}...</span>
                            <button
                              onClick={() => navigator.clipboard.writeText(w.token)}
                              title="Copy token"
                              className="p-0.5 hover:bg-gray-200 rounded"
                            >
                              <Copy size={10} className="text-gray-400" />
                            </button>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-gray-500">{formatDate(w.last_triggered_at)}</td>
                        <td className="px-5 py-3 text-center">
                          {w.is_active
                            ? <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">Active</span>
                            : <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-semibold">Inactive</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
