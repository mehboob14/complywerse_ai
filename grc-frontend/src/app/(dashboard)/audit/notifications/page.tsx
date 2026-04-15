'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import {
  Bell,
  Plus,
  Edit2,
  Trash2,
  X,
  Search,
  Mail,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Sparkles,
} from 'lucide-react';

const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  engagement_kickoff: 'Engagement Kickoff',
  finding_notification: 'Finding Notification',
  remediation_due: 'Remediation Due',
  remediation_overdue: 'Remediation Overdue',
  report_issued: 'Report Issued',
  plan_approved: 'Plan Approved',
  follow_up_scheduled: 'Follow-up Scheduled',
  engagement_completed: 'Engagement Completed',
  custom: 'Custom',
};

const TEMPLATE_TYPE_ICONS: Record<string, any> = {
  engagement_kickoff: Mail,
  finding_notification: AlertTriangle,
  remediation_due: Clock,
  remediation_overdue: AlertTriangle,
  report_issued: FileText,
  plan_approved: CheckCircle,
  follow_up_scheduled: Clock,
  engagement_completed: CheckCircle,
  custom: Bell,
};

const TEMPLATE_TYPE_COLORS: Record<string, string> = {
  engagement_kickoff: 'bg-blue-50 text-blue-700 border-blue-200',
  finding_notification: 'bg-amber-50 text-amber-700 border-amber-200',
  remediation_due: 'bg-orange-50 text-orange-700 border-orange-200',
  remediation_overdue: 'bg-red-50 text-red-700 border-red-200',
  report_issued: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  plan_approved: 'bg-green-50 text-green-700 border-green-200',
  follow_up_scheduled: 'bg-purple-50 text-purple-700 border-purple-200',
  engagement_completed: 'bg-teal-50 text-teal-700 border-teal-200',
  custom: 'bg-slate-50 text-slate-700 border-slate-200',
};

const AVAILABLE_VARIABLES = [
  '{{recipient_name}}',
  '{{engagement_title}}',
  '{{engagement_number}}',
  '{{engagement_scope}}',
  '{{planned_start}}',
  '{{planned_end}}',
  '{{lead_auditor}}',
  '{{finding_title}}',
  '{{severity}}',
  '{{finding_condition}}',
  '{{finding_criteria}}',
  '{{finding_cause}}',
  '{{finding_effect}}',
  '{{finding_status}}',
  '{{due_date}}',
  '{{days_overdue}}',
  '{{report_date}}',
  '{{opinion}}',
  '{{total_findings}}',
  '{{critical_findings}}',
  '{{high_findings}}',
];

const defaultForm = {
  name: '',
  template_type: 'engagement_kickoff',
  subject: '',
  body: '',
  trigger_event: '',
  is_active: true,
};

export default function AuditNotificationsPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [form, setForm] = useState(defaultForm);
  const [previewMode, setPreviewMode] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit-notification-templates'],
    queryFn: () => auditApi.notifications.getTemplates().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.notifications.createTemplate(data),
    onSuccess: () => { refetch(); closeModal(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => auditApi.notifications.updateTemplate(id, data),
    onSuccess: () => { refetch(); closeModal(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => auditApi.notifications.deleteTemplate(id),
    onSuccess: () => { refetch(); },
  });

  const seedMutation = useMutation({
    mutationFn: () => auditApi.notifications.seedDefaults(),
    onSuccess: () => { refetch(); },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      auditApi.notifications.updateTemplate(id, { is_active }),
    onSuccess: () => { refetch(); },
  });

  const closeModal = () => {
    setShowModal(false);
    setEditingTemplate(null);
    setForm(defaultForm);
    setPreviewMode(false);
  };

  const openCreate = () => {
    setEditingTemplate(null);
    setForm(defaultForm);
    setShowModal(true);
  };

  const openEdit = (template: any) => {
    setEditingTemplate(template);
    setForm({
      name: template.name || '',
      template_type: template.template_type || 'custom',
      subject: template.subject || '',
      body: template.body || '',
      trigger_event: template.trigger_event || '',
      is_active: template.is_active ?? true,
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const templates = data?.templates || [];
  const templateTypes = data?.template_types || Object.keys(TEMPLATE_TYPE_LABELS);

  const filtered = templates.filter((t: any) => {
    const matchesSearch = !searchTerm || t.name.toLowerCase().includes(searchTerm.toLowerCase()) || t.subject.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = !filterType || t.template_type === filterType;
    return matchesSearch && matchesType;
  });

  const insertVariable = (variable: string) => {
    setForm(prev => ({ ...prev, body: prev.body + variable }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Notification Templates</h1>
          <p className="text-sm text-slate-500 mt-1">Configure email templates for audit workflow notifications</p>
        </div>
        <div className="flex items-center gap-2">
          {templates.length === 0 && (
            <button
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {seedMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Load Defaults
            </button>
          )}
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" /> New Template
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search templates..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:border-blue-500"
        >
          <option value="">All Types</option>
          {templateTypes.map((type: string) => (
            <option key={type} value={type}>{TEMPLATE_TYPE_LABELS[type] || type}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Bell className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">No notification templates found</p>
          <p className="text-sm text-slate-400 mt-1">Create a template or load the default set to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((template: any) => {
            const TypeIcon = TEMPLATE_TYPE_ICONS[template.template_type] || Bell;
            return (
              <div key={template.id} className="bg-white rounded-xl border border-slate-200 p-5 hover:border-blue-200 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${TEMPLATE_TYPE_COLORS[template.template_type] || TEMPLATE_TYPE_COLORS.custom}`}>
                      <TypeIcon className="h-3 w-3" />
                      {TEMPLATE_TYPE_LABELS[template.template_type] || template.template_type}
                    </span>
                    {!template.is_active && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-500">Inactive</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleActiveMutation.mutate({ id: template.id, is_active: !template.is_active })}
                      className="p-1.5 text-slate-400 hover:text-blue-500 rounded-lg hover:bg-slate-50 transition-colors"
                      title={template.is_active ? 'Deactivate' : 'Activate'}
                    >
                      {template.is_active ? <ToggleRight className="h-4 w-4 text-blue-500" /> : <ToggleLeft className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => openEdit(template)}
                      className="p-1.5 text-slate-400 hover:text-blue-500 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => { if (confirm('Delete this template?')) deleteMutation.mutate(template.id); }}
                      className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <h3 className="text-sm font-semibold text-slate-900 mb-1">{template.name}</h3>
                <p className="text-xs text-slate-500 mb-2">
                  <span className="font-medium">Subject:</span> {template.subject}
                </p>
                <p className="text-xs text-slate-400 line-clamp-2">{template.body}</p>
                {template.trigger_event && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-xs text-slate-400">
                      <span className="font-medium">Trigger:</span> {template.trigger_event.replace(/_/g, ' ')}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">
                {editingTemplate ? 'Edit Template' : 'New Notification Template'}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPreviewMode(!previewMode)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${previewMode ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {previewMode ? 'Edit' : 'Preview'}
                </button>
                <button onClick={closeModal} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            {previewMode ? (
              <div className="p-6 space-y-4">
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <p className="text-xs text-slate-400 mb-1">Subject</p>
                  <p className="text-sm font-medium text-slate-900">{form.subject || '(No subject)'}</p>
                </div>
                <div className="bg-white rounded-lg p-4 border border-slate-200">
                  <p className="text-xs text-slate-400 mb-2">Body</p>
                  <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">{form.body || '(No body)'}</pre>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                  <p className="text-xs text-amber-700">
                    Template variables (shown as {`{{variable_name}}`}) will be replaced with actual values when the notification is sent.
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Template Name</label>
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      placeholder="e.g., Engagement Kickoff Notice"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Template Type</label>
                    <select
                      value={form.template_type}
                      onChange={e => setForm({ ...form, template_type: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    >
                      {Object.entries(TEMPLATE_TYPE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Subject Line</label>
                  <input
                    type="text"
                    required
                    value={form.subject}
                    onChange={e => setForm({ ...form, subject: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    placeholder="e.g., Audit Engagement Kickoff: {{engagement_title}}"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Email Body</label>
                  <textarea
                    required
                    value={form.body}
                    onChange={e => setForm({ ...form, body: e.target.value })}
                    rows={10}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500 resize-none font-mono"
                    placeholder="Dear {{recipient_name}},&#10;&#10;..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">Insert Variable</label>
                  <div className="flex flex-wrap gap-1">
                    {AVAILABLE_VARIABLES.map(v => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => insertVariable(v)}
                        className="px-2 py-1 text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100 transition-colors font-mono"
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Trigger Event (optional)</label>
                  <input
                    type="text"
                    value={form.trigger_event}
                    onChange={e => setForm({ ...form, trigger_event: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    placeholder="e.g., engagement_status_change"
                  />
                </div>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg font-medium disabled:opacity-50"
                  >
                    {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : editingTemplate ? 'Update Template' : 'Create Template'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
