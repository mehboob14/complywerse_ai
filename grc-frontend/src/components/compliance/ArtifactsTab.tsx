'use client';

import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import apiClient from '@/lib/api';
import { buildArtifactTemplate, type ArtifactMeta } from './artifactTemplates';
import { downloadAsFormat } from './downloadUtils';
import {
  FileText,
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  User,
  CheckCircle,
  Clock,
  Package,
  Database,
  Shield,
  BookOpen,
  ExternalLink,
  Search,
  List,
  FolderOpen,
  Download,
  Upload,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CatalogItem {
  id: number;
  artifact_id: string;
  stage: string;
  stage_number: number | null;
  name: string;
  artifact_type: string;
  control_ref: string | null;
  mandatory: boolean;
  description: string | null;
  format: string | null;
  owner: string | null;
  is_platform_native: boolean;
  platform_data_type: string | null;
}

interface CatalogData {
  framework_key: string | null;
  framework_name: string | null;
  items: CatalogItem[];
  stages: string[];
}

export interface TenantArtifact {
  id: number;
  catalog_item_id: number | null;
  assessment_id: number | null;
  framework_key: string;
  name: string;
  artifact_type: string;
  stage: string | null;
  control_ref: string | null;
  description: string | null;
  format: string | null;
  content: string | null;
  file_name: string | null;
  status: string;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  created_by_name: string | null;
  is_platform_native: boolean;
  platform_data_type: string | null;
  platform_record_count: number | null;
  created_at: string;
  updated_at: string | null;
}

export interface TenantUser {
  id: number;
  label: string;
  email: string | null;
}

interface PlatformDataItem {
  id: number;
  title?: string;
  name?: string;
  [key: string]: unknown;
}

interface PlatformData {
  total: number;
  items: PlatformDataItem[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft:     { bg: 'bg-gray-100',    text: 'text-gray-600',    label: 'Draft'     },
  in_review: { bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'In Review' },
  approved:  { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Approved'  },
  archived:  { bg: 'bg-gray-200',   text: 'text-gray-500',    label: 'Archived'  },
};

const TYPE_ICON_MAP: Record<string, typeof FileText> = {
  Policy:        BookOpen,
  Procedure:     FileText,
  Register:      Database,
  Report:        FileText,
  Plan:          FileText,
  Evidence:      Shield,
  Attestation:   CheckCircle,
  'Record/Log':  FileText,
  'Form/Template': FileText,
  Standard:      BookOpen,
};

function getTypeIcon(type: string) {
  return TYPE_ICON_MAP[type] || FileText;
}


// ─── Platform Data Panel ─────────────────────────────────────────────────────

function PlatformDataPanel({ dataType }: { dataType: string }) {
  const endpoint =
    dataType === 'risk_register'
      ? '/artifacts/platform-data/risk-register'
      : '/artifacts/platform-data/asset-inventory';

  const label    = dataType === 'risk_register' ? 'Risk Register' : 'Asset Inventory';
  const linkHref = dataType === 'risk_register' ? '/risks' : '/assets';

  const { data, isLoading } = useQuery<PlatformData>({
    queryKey: ['artifact-platform-data', dataType],
    queryFn: async () => { const r = await apiClient.get(endpoint); return r.data; },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="mt-3 p-3 bg-blue-50 rounded-lg text-xs text-blue-700 flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 animate-spin" /> Loading platform data...
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-blue-800 flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5" /> Live Platform: {label}
        </span>
        <a href={linkHref} target="_blank" rel="noopener noreferrer"
           className="text-xs text-blue-600 hover:underline flex items-center gap-1">
          Open <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <p className="text-xs text-blue-700 mb-2"><strong>{data?.total ?? 0}</strong> records in your {label}.</p>
      <div className="max-h-32 overflow-y-auto space-y-1">
        {(data?.items ?? []).slice(0, 10).map((item) => (
          <div key={item.id} className="text-xs text-blue-800 px-2 py-1 bg-white rounded border border-blue-100 truncate">
            {item.title || item.name || `Record #${item.id}`}
          </div>
        ))}
        {(data?.total ?? 0) > 10 && (
          <p className="text-xs text-blue-600 text-center">+{(data?.total ?? 0) - 10} more</p>
        )}
      </div>
    </div>
  );
}

// ─── Markdown preview ────────────────────────────────────────────────────────

const mdComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  h1: ({ children }) => <h1 className="text-xl font-bold text-gray-900 mb-3 mt-5 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold text-gray-800 mb-2 mt-4 pb-1 border-b border-gray-200">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-700 mb-1.5 mt-3">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-semibold text-gray-700 mb-1 mt-2">{children}</h4>,
  h5: ({ children }) => <h5 className="text-xs font-semibold text-gray-700 mb-1 mt-2 uppercase tracking-wider">{children}</h5>,
  h6: ({ children }) => <h6 className="text-xs font-semibold text-gray-600 mb-1 mt-2">{children}</h6>,
  p:  ({ children }) => <p className="text-sm text-gray-700 mb-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="text-sm text-gray-700 mb-3 pl-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="text-sm text-gray-700 mb-3 pl-5 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed pl-1">{children}</li>,
  table: ({ children }) => (
    <div className="overflow-x-auto mb-3 mt-1 rounded-lg border border-gray-200">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-gray-200">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-gray-50">{children}</tr>,
  th: ({ children }) => <th className="text-left px-3 py-2 font-semibold text-gray-700 border-r last:border-r-0 border-gray-200">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 text-gray-700 border-r last:border-r-0 border-gray-200 align-top">{children}</td>,
  hr: () => <hr className="border-gray-200 my-4" />,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em: ({ children }) => <em className="italic text-gray-700">{children}</em>,
  code: ({ children }) => <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono text-gray-800">{children}</code>,
  pre: ({ children }) => <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto text-xs font-mono text-gray-800 mb-3">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="border-l-4 border-blue-300 pl-3 text-gray-600 italic my-2">{children}</blockquote>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
      {children}
    </a>
  ),
};

const mdRemarkPlugins = [remarkGfm];

function EditPreviewToggle({
  mode, onChange,
}: { mode: 'edit' | 'preview'; onChange: (m: 'edit' | 'preview') => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
      <button
        onClick={() => onChange('edit')}
        className={`px-2.5 py-1 text-xs rounded-md transition-colors ${mode === 'edit' ? 'bg-white text-gray-800 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
        Edit
      </button>
      <button
        onClick={() => onChange('preview')}
        className={`px-2.5 py-1 text-xs rounded-md transition-colors ${mode === 'preview' ? 'bg-white text-gray-800 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
        Preview
      </button>
    </div>
  );
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

export function CreateArtifactModal({
  item,
  frameworkKey,
  frameworkName,
  assessmentId,
  tenantUsers,
  onConfirm,
  onClose,
  isPending,
}: {
  item: CatalogItem;
  frameworkKey: string;
  frameworkName: string;
  assessmentId?: number;
  tenantUsers: TenantUser[];
  onConfirm: (payload: Record<string, unknown>) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const meta: ArtifactMeta = {
    name: item.name,
    artifactType: item.artifact_type,
    controlRef: item.control_ref,
    description: item.description,
    frameworkName,
    frameworkKey,
    stage: item.stage,
    artifactId: item.artifact_id,
    owner: item.owner,
    format: item.format,
  };

  const [name, setName]           = useState(item.name);
  const [description, setDescription] = useState(item.description || '');
  const [content, setContent]     = useState(item.is_platform_native ? '' : buildArtifactTemplate(meta));
  const [assignedToId, setAssignedToId] = useState<number | null>(null);
  const [contentMode, setContentMode] = useState<'edit' | 'preview'>('preview');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setContent(ev.target?.result as string ?? '');
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 flex-shrink-0">
              {(() => { const Icon = getTypeIcon(item.artifact_type); return <Icon className="h-4 w-4" />; })()}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-black">Create Artifact</h2>
              <p className="text-xs text-gray-500">{item.stage} · {item.artifact_type} · {frameworkName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 flex-shrink-0"><X className="h-4 w-4" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Meta chips */}
          <div className="flex flex-wrap gap-2">
            {item.control_ref && <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded font-mono">{item.control_ref}</span>}
            {item.mandatory   && <span className="px-2 py-0.5 text-xs bg-rose-50 text-rose-600 rounded font-medium">Mandatory</span>}
            {item.is_platform_native && <span className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded flex items-center gap-1"><Database className="h-3 w-3" /> Platform Data</span>}
            {item.format && <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">{item.format}</span>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Artifact Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Owner</label>
            <select value={assignedToId ?? ''} onChange={(e) => setAssignedToId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Unassigned —</option>
              {tenantUsers.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </div>

          {item.is_platform_native ? (
            <>
              <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
                <p className="text-sm font-medium text-purple-800 flex items-center gap-2 mb-1">
                  <Database className="h-4 w-4" /> Live Platform Artifact
                </p>
                <p className="text-xs text-purple-700">
                  This artifact automatically links to your live <strong>{item.platform_data_type?.replace('_', ' ')}</strong> data.
                  No manual content required.
                </p>
              </div>
              {item.platform_data_type && <PlatformDataPanel dataType={item.platform_data_type} />}
            </>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-700">
                  Document Content
                  <span className="ml-1.5 text-gray-400 font-normal">({item.artifact_type} template)</span>
                </label>
                <div className="flex items-center gap-2">
                  <EditPreviewToggle mode={contentMode} onChange={setContentMode} />
                  <button onClick={() => fileRef.current?.click()}
                    className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50">
                    <Upload className="h-3 w-3" /> Replace with file
                  </button>
                  <input ref={fileRef} type="file" accept=".md,.txt" className="hidden" onChange={handleFileUpload} />
                </div>
              </div>
              {contentMode === 'preview' ? (
                <div
                  onClick={() => setContentMode('edit')}
                  className="min-h-[20rem] max-h-[28rem] overflow-y-auto px-4 py-4 border border-gray-300 rounded-lg bg-white cursor-text">
                  <ReactMarkdown remarkPlugins={mdRemarkPlugins} components={mdComponents}>{content}</ReactMarkdown>
                </div>
              ) : (
                <textarea rows={18} value={content} onChange={(e) => setContent(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y bg-gray-50 leading-relaxed" />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
          <div className="text-xs text-gray-400">Review the document above, switch to Edit to modify, then click Create.</div>
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => onConfirm({
                catalog_item_id: item.id,
                assessment_id: assessmentId,
                framework_key: frameworkKey,
                name,
                artifact_type: item.artifact_type,
                stage: item.stage,
                control_ref: item.control_ref,
                description,
                format: item.format,
                content: item.is_platform_native ? null : content,
                assigned_to_id: assignedToId,
                is_platform_native: item.is_platform_native,
                platform_data_type: item.platform_data_type,
              })}
              disabled={isPending || !name.trim()}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {isPending ? <Clock className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Create Artifact
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

export function EditArtifactModal({
  artifact,
  tenantUsers,
  onSave,
  onClose,
  isPending,
}: {
  artifact: TenantArtifact;
  tenantUsers: TenantUser[];
  onSave: (data: Partial<TenantArtifact>) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [name, setName]               = useState(artifact.name);
  const [content, setContent]         = useState(artifact.content || '');
  const [description, setDescription] = useState(artifact.description || '');
  const [status, setStatus]           = useState(artifact.status);
  const [assignedToId, setAssignedToId] = useState<number | null>(artifact.assigned_to_id);
  const [contentMode, setContentMode] = useState<'edit' | 'preview'>('preview');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setContent(ev.target?.result as string ?? '');
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-black">Edit Artifact</h2>
            <p className="text-xs text-gray-500">{artifact.artifact_type} · {artifact.stage?.replace(/Stage \d+:\s*/, '') || ''}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="draft">Draft</option>
                <option value="in_review">In Review</option>
                <option value="approved">Approved</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Owner</label>
              <select value={assignedToId ?? ''} onChange={(e) => setAssignedToId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Unassigned —</option>
                {tenantUsers.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
            </div>
          </div>

          {artifact.is_platform_native && artifact.platform_data_type ? (
            <PlatformDataPanel dataType={artifact.platform_data_type} />
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-700">Content</label>
                <div className="flex items-center gap-2">
                  <EditPreviewToggle mode={contentMode} onChange={setContentMode} />
                  <button onClick={() => downloadAsFormat(artifact.name, content, artifact.format, artifact.artifact_type)}
                    className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50">
                    <Download className="h-3 w-3" /> Download
                  </button>
                  <button onClick={() => fileRef.current?.click()}
                    className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50">
                    <Upload className="h-3 w-3" /> Upload
                  </button>
                  <input ref={fileRef} type="file" accept=".md,.txt" className="hidden" onChange={handleFileUpload} />
                </div>
              </div>
              {contentMode === 'preview' ? (
                <div
                  onClick={() => setContentMode('edit')}
                  className="min-h-[20rem] max-h-[28rem] overflow-y-auto px-4 py-4 border border-gray-300 rounded-lg bg-white cursor-text">
                  {content
                    ? <ReactMarkdown remarkPlugins={mdRemarkPlugins} components={mdComponents}>{content}</ReactMarkdown>
                    : <p className="text-sm text-gray-400 italic">No content yet. Switch to Edit to add content.</p>
                  }
                </div>
              ) : (
                <textarea rows={18} value={content} onChange={(e) => setContent(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y bg-gray-50 leading-relaxed"
                  placeholder="Enter artifact content..." />
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100">Cancel</button>
          <button
            onClick={() => onSave({ name, content, description, status, assigned_to_id: assignedToId })}
            disabled={isPending}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {isPending ? <Clock className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ArtifactsTab({
  assessmentId,
  assessmentType,
  tenantId,
  tenantUsers,
}: {
  assessmentId?: number;
  assessmentType: string;
  tenantId?: number;
  tenantUsers: TenantUser[];
}) {
  const queryClient = useQueryClient();
  const [activeSubTab, setActiveSubTab]     = useState<'catalog' | 'my-artifacts'>('catalog');
  const [activeStage, setActiveStage]       = useState<string>('all');
  const [searchQuery, setSearchQuery]       = useState('');
  const [expandedItem, setExpandedItem]     = useState<number | null>(null);
  const [editingArtifact, setEditingArtifact] = useState<TenantArtifact | null>(null);
  const [createFromItem, setCreateFromItem] = useState<CatalogItem | null>(null);

  const { data: catalog, isLoading: catalogLoading } = useQuery<CatalogData>({
    queryKey: ['artifact-catalog', assessmentType],
    queryFn: async () => {
      const r = await apiClient.get('/artifacts/catalog', { params: { assessment_type: assessmentType } });
      return r.data;
    },
    staleTime: 5 * 60_000,
  });

  const { data: tenantArtifacts = [], isLoading: artifactsLoading } = useQuery<TenantArtifact[]>({
    queryKey: ['tenant-artifacts', assessmentId, assessmentType],
    queryFn: async () => {
      const params: Record<string, unknown> = { assessment_type: assessmentType };
      if (assessmentId != null) params.assessment_id = assessmentId;
      const r = await apiClient.get('/artifacts', { params });
      return Array.isArray(r.data) ? r.data : [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const r = await apiClient.post('/artifacts', payload);
      return r.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-artifacts', assessmentId, assessmentType] });
      setCreateFromItem(null);
      setActiveSubTab('my-artifacts');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<TenantArtifact> }) => {
      const r = await apiClient.put(`/artifacts/${id}`, data);
      return r.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-artifacts', assessmentId, assessmentType] });
      setEditingArtifact(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiClient.delete(`/artifacts/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-artifacts', assessmentId, assessmentType] });
    },
  });

  const catalogItems  = catalog?.items       ?? [];
  const stages        = catalog?.stages      ?? [];
  const frameworkName = catalog?.framework_name ?? null;
  const frameworkKey  = catalog?.framework_key  ?? assessmentType;

  const filteredCatalog = catalogItems.filter((item) => {
    const matchStage  = activeStage === 'all' || item.stage === activeStage;
    const matchSearch = !searchQuery
      || item.name.toLowerCase().includes(searchQuery.toLowerCase())
      || (item.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    return matchStage && matchSearch;
  });

  const catalogByStage: Record<string, CatalogItem[]> = {};
  filteredCatalog.forEach((item) => {
    if (!catalogByStage[item.stage]) catalogByStage[item.stage] = [];
    catalogByStage[item.stage].push(item);
  });

  const createdByCatalogId = new Map<number, TenantArtifact>();
  tenantArtifacts.forEach((a) => { if (a.catalog_item_id) createdByCatalogId.set(a.catalog_item_id, a); });

  if (catalogLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 gap-2">
        <Clock className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading artifact catalog...</span>
      </div>
    );
  }

  if (!frameworkName) {
    return (
      <div className="text-center py-16">
        <Package className="h-12 w-12 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-500 font-medium">No artifact catalog available</p>
        <p className="text-xs text-gray-400 mt-1">
          Framework <code className="bg-gray-100 px-1 rounded">{assessmentType}</code> is not mapped to a catalog.
        </p>
      </div>
    );
  }

  const totalCatalogItems = catalogItems.length;
  const createdCount      = tenantArtifacts.length;

  return (
    <>
      {createFromItem && (
        <CreateArtifactModal
          item={createFromItem}
          frameworkKey={frameworkKey}
          frameworkName={frameworkName}
          assessmentId={assessmentId}
          tenantUsers={tenantUsers}
          onConfirm={(payload) => createMutation.mutate(payload)}
          onClose={() => setCreateFromItem(null)}
          isPending={createMutation.isPending}
        />
      )}
      {editingArtifact && (
        <EditArtifactModal
          artifact={editingArtifact}
          tenantUsers={tenantUsers}
          onSave={(data) => updateMutation.mutate({ id: editingArtifact.id, data })}
          onClose={() => setEditingArtifact(null)}
          isPending={updateMutation.isPending}
        />
      )}

      <div className="space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-sm font-semibold text-black flex items-center gap-2">
            <Package className="h-4 w-4 text-blue-600" />
            {frameworkName} — Artifacts
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">{totalCatalogItems} in catalog · {createdCount} created</p>
        </div>

        {/* Sub-tabs */}
        <div className="flex items-center gap-0 border-b border-gray-200">
          {([
            { id: 'catalog'      as const, label: 'Artifact Catalog', Icon: List,       count: totalCatalogItems },
            { id: 'my-artifacts' as const, label: 'My Artifacts',     Icon: FolderOpen, count: createdCount },
          ] as const).map(({ id, label, Icon, count }) => (
            <button
              key={id}
              onClick={() => setActiveSubTab(id)}
              className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeSubTab === id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {count > 0 && (
                <span className={`ml-1 px-1.5 py-0.5 text-xs rounded-full ${
                  activeSubTab === id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                }`}>{count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Artifact Catalog ── */}
        {activeSubTab === 'catalog' && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-gray-500">
                  {totalCatalogItems} required artifacts across {stages.length} stages. Click <strong>Create</strong> to generate a structured document.
                </p>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <input
                    type="text" placeholder="Search artifacts..."
                    value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
                  />
                </div>
              </div>
              {/* Stage filter */}
              <div className="flex items-center gap-1 mt-3 overflow-x-auto pb-1">
                <button
                  onClick={() => setActiveStage('all')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap flex-shrink-0 transition-colors ${
                    activeStage === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  All ({totalCatalogItems})
                </button>
                {stages.map((stage) => {
                  const cnt = catalogItems.filter((i) => i.stage === stage).length;
                  const label = stage.replace(/Stage \d+:\s*/, '').split(' ').slice(0, 2).join(' ');
                  return (
                    <button key={stage} title={stage}
                      onClick={() => setActiveStage(stage === activeStage ? 'all' : stage)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap flex-shrink-0 transition-colors ${
                        activeStage === stage ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {label} ({cnt})
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="divide-y divide-gray-100">
              {Object.entries(catalogByStage).length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No artifacts match your search.</p>
                </div>
              ) : (
                Object.entries(catalogByStage).map(([stage, items]) => (
                  <div key={stage}>
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 sticky top-0">
                      <p className="text-xs font-semibold text-gray-700">{stage}</p>
                    </div>
                    {items.map((item) => {
                      const Icon     = getTypeIcon(item.artifact_type);
                      const isExp    = expandedItem === item.id;
                      const existing = createdByCatalogId.get(item.id);

                      return (
                        <div key={item.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-600 flex-shrink-0 mt-0.5">
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  onClick={() => setExpandedItem(isExp ? null : item.id)}
                                  className="text-sm font-medium text-black hover:text-blue-600 text-left"
                                >
                                  {item.name}
                                </button>
                                {item.mandatory && (
                                  <span className="px-1.5 py-0.5 text-xs bg-rose-50 text-rose-600 rounded font-medium">M</span>
                                )}
                                {item.is_platform_native && (
                                  <span className="px-1.5 py-0.5 text-xs bg-purple-50 text-purple-600 rounded flex items-center gap-1">
                                    <Database className="h-2.5 w-2.5" /> Platform
                                  </span>
                                )}
                                <span className="text-xs text-gray-400">{item.artifact_type}</span>
                                {item.control_ref && <span className="text-xs text-gray-400 font-mono">{item.control_ref}</span>}
                              </div>
                              {item.description && !isExp && (
                                <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{item.description}</p>
                              )}
                              {isExp && (
                                <div className="mt-2 space-y-1 text-xs text-gray-600">
                                  {item.description && <p>{item.description}</p>}
                                  {item.owner  && <p><strong>Owner:</strong> {item.owner}</p>}
                                  {item.format && <p><strong>Format:</strong> {item.format}</p>}
                                  {item.is_platform_native && (
                                    <p className="text-purple-600">
                                      Links to live <strong>{item.platform_data_type?.replace('_', ' ')}</strong> data in your platform.
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex-shrink-0">
                              {existing ? (
                                <span className="px-2 py-1 text-xs bg-emerald-50 text-emerald-700 rounded-lg flex items-center gap-1">
                                  <CheckCircle className="h-3 w-3" /> Created
                                </span>
                              ) : (
                                <button
                                  onClick={() => setCreateFromItem(item)}
                                  className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5"
                                >
                                  <Plus className="h-3 w-3" /> Create
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── My Artifacts ── */}
        {activeSubTab === 'my-artifacts' && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            {artifactsLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-gray-500">
                <Clock className="h-4 w-4 animate-spin" /><span className="text-sm">Loading...</span>
              </div>
            ) : createdCount === 0 ? (
              <div className="text-center py-14">
                <FolderOpen className="h-12 w-12 text-gray-200 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-500">No artifacts created yet</p>
                <p className="text-xs text-gray-400 mt-1">Go to Artifact Catalog and click Create to get started.</p>
                <button onClick={() => setActiveSubTab('catalog')}
                  className="mt-4 px-4 py-2 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50">
                  Browse Catalog
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {tenantArtifacts.map((artifact) => {
                  const Icon        = getTypeIcon(artifact.artifact_type);
                  const statusStyle = STATUS_STYLES[artifact.status] ?? STATUS_STYLES.draft;

                  return (
                    <div key={artifact.id} className="p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 flex-shrink-0 mt-0.5">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-black truncate">{artifact.name}</p>
                              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                                {statusStyle.label}
                              </span>
                              {artifact.is_platform_native && (
                                <span className="px-2 py-0.5 text-xs rounded-full bg-purple-50 text-purple-700 flex items-center gap-1">
                                  <Database className="h-2.5 w-2.5" /> Platform Data
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                              <span>{artifact.artifact_type}</span>
                              {artifact.stage && <span>· {artifact.stage.replace(/Stage \d+:\s*/, '')}</span>}
                              {artifact.control_ref && <span>· {artifact.control_ref}</span>}
                              {artifact.assigned_to_name && (
                                <span className="flex items-center gap-1">· <User className="h-3 w-3" /> {artifact.assigned_to_name}</span>
                              )}
                              {artifact.created_by_name && (
                                <span className="text-gray-400">· by {artifact.created_by_name}</span>
                              )}
                            </div>
                            {artifact.is_platform_native && artifact.platform_data_type && (
                              <p className="text-xs text-purple-600 mt-1">
                                Live platform data · {artifact.platform_record_count ?? '—'} records
                              </p>
                            )}
                            {!artifact.is_platform_native && artifact.content && (
                              <p className="text-xs text-gray-400 mt-1 line-clamp-1 font-mono">
                                {artifact.content.split('\n').find((l) => l.trim()) || ''}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {!artifact.is_platform_native && artifact.content && (
                            <button
                              onClick={() => downloadAsFormat(artifact.name, artifact.content!, artifact.format, artifact.artifact_type)}
                              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                              title="Download"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => setEditingArtifact(artifact)}
                            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete "${artifact.name}"?`)) deleteMutation.mutate(artifact.id); }}
                            className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
