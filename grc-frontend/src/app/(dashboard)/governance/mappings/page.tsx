'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { governanceApi, controlsApi } from '@/lib/api';
import {
  FileText,
  Search,
  Link2,
  Unlink,
  X,
  ChevronRight,
  BookOpen,
  FileCheck,
  ClipboardList,
  Lightbulb,
  Shield,
  Layers,
  Plus,
  AlertCircle,
  CheckCircle,
  Loader2,
} from 'lucide-react';

interface DocumentItem {
  id: number;
  document_code: string | null;
  title: string;
  doc_type: string;
  status: string;
}

interface ControlLink {
  id: number;
  normalized_control_id: number;
  control_code: string | null;
  control_name: string | null;
  link_type: string;
  notes: string | null;
  created_at: string | null;
}

interface NormalizedControl {
  id: number;
  code: string;
  name: string;
  description?: string;
  domain?: string;
  category?: string;
}

interface DocumentMappings {
  document_id: number;
  document_title: string;
  control_links: ControlLink[];
  risk_links: unknown[];
  regulatory_links: unknown[];
  asset_links: unknown[];
}

const DOCUMENT_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'policy', label: 'Policy', icon: BookOpen, color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
  { value: 'standard', label: 'Standard', icon: FileCheck, color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  { value: 'procedure', label: 'Procedure', icon: ClipboardList, color: 'text-green-400', bgColor: 'bg-green-500/20' },
  { value: 'guideline', label: 'Guideline', icon: Lightbulb, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  { value: 'charter', label: 'Charter', icon: Shield, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
  { value: 'framework', label: 'Framework', icon: Layers, color: 'text-orange-400', bgColor: 'bg-orange-500/20' },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-slate-500/20', text: 'text-gray-600' },
  pending_review: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  pending_approval: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  approved: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  published: { bg: 'bg-green-500/20', text: 'text-green-400' },
  expired: { bg: 'bg-red-500/20', text: 'text-red-400' },
  archived: { bg: 'bg-gray-500/20', text: 'text-gray-700' },
};

const LINK_TYPES = [
  { value: 'implements', label: 'Implements' },
  { value: 'supports', label: 'Supports' },
  { value: 'references', label: 'References' },
  { value: 'derives_from', label: 'Derives From' },
];

const getTypeStyle = (type: string) => {
  return DOCUMENT_TYPES.find(t => t.value === type) || { 
    label: type, 
    color: 'text-gray-600', 
    bgColor: 'bg-slate-500/20', 
    icon: FileText 
  };
};

const getStatusStyle = (status: string) => {
  return STATUS_COLORS[status] || { bg: 'bg-slate-500/20', text: 'text-gray-600' };
};

export default function GovernanceMappingsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [controlSearchTerm, setControlSearchTerm] = useState('');
  const [selectedLinkType, setSelectedLinkType] = useState('implements');
  const [linkNotes, setLinkNotes] = useState('');
  const queryClient = useQueryClient();

  const { data: documentsData, isLoading: documentsLoading } = useQuery({
    queryKey: ['governance-documents-list', typeFilter, searchTerm],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: 100 };
      if (typeFilter) params.doc_type = typeFilter;
      if (searchTerm) params.search = searchTerm;
      const response = await governanceApi.getDocuments(params as any);
      return response.data;
    },
  });

  const { data: mappingsData, isLoading: mappingsLoading } = useQuery({
    queryKey: ['document-mappings', selectedDocumentId],
    queryFn: async () => {
      if (!selectedDocumentId) return null;
      const response = await governanceApi.getDocumentMappings(selectedDocumentId);
      return response.data as DocumentMappings;
    },
    enabled: !!selectedDocumentId,
  });

  const { data: allControlsData, isLoading: controlsLoading } = useQuery({
    queryKey: ['normalized-controls'],
    queryFn: async () => {
      const response = await controlsApi.getNormalized();
      return response.data as NormalizedControl[];
    },
  });

  const linkMutation = useMutation({
    mutationFn: (data: { document_id: number; normalized_control_id: number; link_type: string; notes?: string }) =>
      governanceApi.linkControl(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-mappings', selectedDocumentId] });
      setShowLinkModal(false);
      setControlSearchTerm('');
      setLinkNotes('');
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (linkId: number) => governanceApi.unlinkControl(linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-mappings', selectedDocumentId] });
    },
  });

  const documents = useMemo(() => {
    const items = (documentsData as any)?.items || documentsData || [];
    return items as DocumentItem[];
  }, [documentsData]);

  const linkedControlIds = useMemo(() => {
    return new Set(mappingsData?.control_links?.map(link => link.normalized_control_id) || []);
  }, [mappingsData]);

  const filteredControls = useMemo(() => {
    if (!allControlsData) return [];
    return allControlsData.filter(control => {
      const matchesSearch = !controlSearchTerm || 
        control.code.toLowerCase().includes(controlSearchTerm.toLowerCase()) ||
        control.name.toLowerCase().includes(controlSearchTerm.toLowerCase()) ||
        control.description?.toLowerCase().includes(controlSearchTerm.toLowerCase());
      const notLinked = !linkedControlIds.has(control.id);
      return matchesSearch && notLinked;
    });
  }, [allControlsData, controlSearchTerm, linkedControlIds]);

  const coverageSummary = useMemo(() => {
    const totalDocs = documents.length;
    let docsWithMappings = 0;
    let totalMappings = 0;
    
    if (mappingsData) {
      totalMappings = mappingsData.control_links.length;
    }
    
    const docsByType: Record<string, number> = {};
    documents.forEach(doc => {
      docsByType[doc.doc_type] = (docsByType[doc.doc_type] || 0) + 1;
    });
    
    return { totalDocs, docsWithMappings, totalMappings, docsByType };
  }, [documents, mappingsData]);

  const selectedDocument = useMemo(() => {
    return documents.find(d => d.id === selectedDocumentId);
  }, [documents, selectedDocumentId]);

  const handleLinkControl = (controlId: number) => {
    if (!selectedDocumentId) return;
    linkMutation.mutate({
      document_id: selectedDocumentId,
      normalized_control_id: controlId,
      link_type: selectedLinkType,
      notes: linkNotes || undefined,
    });
  };

  const handleUnlinkControl = (linkId: number) => {
    if (confirm('Are you sure you want to unlink this control?')) {
      unlinkMutation.mutate(linkId);
    }
  };

  if (documentsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-black">Policy-Control Mappings</h2>
          <p className="text-sm text-gray-600">Link governance documents to controls</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">Documents:</span>
            <span className="font-semibold text-black">{coverageSummary.totalDocs}</span>
          </div>
          {selectedDocumentId && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">Linked Controls:</span>
              <span className="font-semibold text-primary-400">{mappingsData?.control_links?.length || 0}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(coverageSummary.docsByType).map(([type, count]) => {
          const style = getTypeStyle(type);
          const Icon = style.icon || FileText;
          return (
            <div
              key={type}
              className="rounded-lg border border-gray-300/50 bg-white/50 p-4 hover:bg-gray-100/50 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className={`rounded-lg ${style.bgColor} p-2.5`}>
                  <Icon className={`h-5 w-5 ${style.color}`} />
                </div>
                <div>
                  <p className="text-xl font-bold text-black">{count}</p>
                  <p className="text-xs text-gray-600 capitalize">{type}s</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Documents</h3>
              <p className="card-description">Select a document to view and manage mappings</p>
            </div>
          </div>

          <div className="space-y-4 mb-4">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
                <input
                  type="text"
                  placeholder="Search documents..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white pl-10 pr-4 py-2 text-sm text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {documents.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="h-12 w-12 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-600">No documents found</p>
              </div>
            ) : (
              documents.map((doc) => {
                const typeStyle = getTypeStyle(doc.doc_type);
                const statusStyle = getStatusStyle(doc.status);
                const Icon = typeStyle.icon || FileText;
                const isSelected = selectedDocumentId === doc.id;

                return (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocumentId(doc.id)}
                    className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                      isSelected
                        ? 'border-primary-500 bg-primary-500/10'
                        : 'border-gray-300/50 bg-white/50 hover:bg-gray-100/50 hover:border-gray-300'
                    }`}
                  >
                    <div className={`rounded-lg ${typeStyle.bgColor} p-2`}>
                      <Icon className={`h-4 w-4 ${typeStyle.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-black truncate">{doc.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {doc.document_code && (
                          <span className="text-xs text-gray-600">{doc.document_code}</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusStyle.bg} ${statusStyle.text} capitalize`}>
                          {doc.status.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className={`h-4 w-4 text-gray-600 ${isSelected ? 'text-primary-400' : ''}`} />
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                {selectedDocument ? 'Linked Controls' : 'Control Mappings'}
              </h3>
              <p className="card-description">
                {selectedDocument 
                  ? `Controls linked to "${selectedDocument.title}"`
                  : 'Select a document to view linked controls'
                }
              </p>
            </div>
            {selectedDocumentId && (
              <button
                onClick={() => setShowLinkModal(true)}
                className="btn-primary btn-sm"
              >
                <Plus className="h-4 w-4" />
                Link Control
              </button>
            )}
          </div>

          {!selectedDocumentId ? (
            <div className="text-center py-12">
              <Link2 className="h-12 w-12 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-600">Select a document from the left panel</p>
              <p className="text-sm text-gray-700 mt-1">to view and manage control mappings</p>
            </div>
          ) : mappingsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
            </div>
          ) : mappingsData?.control_links?.length === 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-600">No controls linked</p>
              <p className="text-sm text-gray-700 mt-1">Click "Link Control" to add mappings</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {mappingsData?.control_links?.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-300/50 bg-white/50 p-3 hover:bg-gray-100/50 transition-all"
                >
                  <div className="rounded-lg bg-emerald-500/20 p-2">
                    <Shield className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-black">{link.control_code}</p>
                    <p className="text-sm text-gray-600 truncate">{link.control_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-400 capitalize">
                        {link.link_type.replace('_', ' ')}
                      </span>
                      {link.notes && (
                        <span className="text-xs text-gray-700 truncate max-w-32">{link.notes}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleUnlinkControl(link.id)}
                    disabled={unlinkMutation.isPending}
                    className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                    title="Unlink control"
                  >
                    <Unlink className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl border border-gray-300 bg-white p-6 shadow-2xl mx-4">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-black">Link Control</h3>
                <p className="text-sm text-gray-600">
                  Search and select a control to link to "{selectedDocument?.title}"
                </p>
              </div>
              <button
                onClick={() => {
                  setShowLinkModal(false);
                  setControlSearchTerm('');
                  setLinkNotes('');
                }}
                className="p-2 text-gray-600 hover:text-black rounded-lg hover:bg-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
                <input
                  type="text"
                  placeholder="Search controls by code or name..."
                  value={controlSearchTerm}
                  onChange={(e) => setControlSearchTerm(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white pl-10 pr-4 py-2.5 text-sm text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  autoFocus
                />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-800 mb-1">Link Type</label>
                  <select
                    value={selectedLinkType}
                    onChange={(e) => setSelectedLinkType(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    {LINK_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-800 mb-1">Notes (optional)</label>
                  <input
                    type="text"
                    placeholder="Add notes..."
                    value={linkNotes}
                    onChange={(e) => setLinkNotes(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div className="border border-gray-300 rounded-lg max-h-64 overflow-y-auto">
                {controlsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
                  </div>
                ) : filteredControls.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-600">
                      {controlSearchTerm ? 'No matching controls found' : 'All controls are already linked'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-700">
                    {filteredControls.slice(0, 50).map((control) => (
                      <button
                        key={control.id}
                        onClick={() => handleLinkControl(control.id)}
                        disabled={linkMutation.isPending}
                        className="w-full flex items-center gap-3 p-3 text-left hover:bg-white transition-all disabled:opacity-50"
                      >
                        <div className="rounded-lg bg-primary-500/20 p-2">
                          <Shield className="h-4 w-4 text-primary-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-black">{control.code}</p>
                          <p className="text-sm text-gray-600 truncate">{control.name}</p>
                          {control.domain && (
                            <p className="text-xs text-gray-700 mt-0.5">{control.domain}</p>
                          )}
                        </div>
                        <Plus className="h-4 w-4 text-primary-400" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {filteredControls.length > 50 && (
                <p className="text-xs text-gray-700 text-center">
                  Showing first 50 results. Use search to narrow down.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-300">
              <button
                onClick={() => {
                  setShowLinkModal(false);
                  setControlSearchTerm('');
                  setLinkNotes('');
                }}
                className="px-4 py-2 text-sm font-medium text-gray-800 hover:text-black rounded-lg hover:bg-white transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
