'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { frameworksApi } from '@/lib/api';
import {
  X,
  FileStack,
  Save,
  Plus,
  Trash2,
  Upload,
  ChevronDown,
  ChevronRight,
  Loader2,
  Building2,
  Globe,
  FileJson
} from 'lucide-react';

interface CreateFrameworkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DomainInput {
  id: string;
  name: string;
  description: string;
  objectives: ObjectiveInput[];
  isExpanded: boolean;
}

interface ObjectiveInput {
  id: string;
  reference_code: string;
  name: string;
  description: string;
}

export default function CreateFrameworkModal({
  isOpen,
  onClose,
}: CreateFrameworkModalProps) {
  const queryClient = useQueryClient();
  
  const [name, setName] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [version, setVersion] = useState('1.0');
  const [description, setDescription] = useState('');
  const [regulator, setRegulator] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [domains, setDomains] = useState<DomainInput[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState('');

  const createMutation = useMutation({
    mutationFn: (data: any) => frameworksApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['frameworks'] });
      handleClose();
    },
  });

  const handleClose = () => {
    setName('');
    setShortCode('');
    setVersion('1.0');
    setDescription('');
    setRegulator('');
    setJurisdiction('');
    setDomains([]);
    setShowImport(false);
    setImportJson('');
    setImportError('');
    onClose();
  };

  const addDomain = () => {
    setDomains([
      ...domains,
      {
        id: Date.now().toString(),
        name: '',
        description: '',
        objectives: [],
        isExpanded: true,
      },
    ]);
  };

  const removeDomain = (id: string) => {
    setDomains(domains.filter((d) => d.id !== id));
  };

  const updateDomain = (id: string, field: keyof DomainInput, value: any) => {
    setDomains(
      domains.map((d) => (d.id === id ? { ...d, [field]: value } : d))
    );
  };

  const addObjective = (domainId: string) => {
    setDomains(
      domains.map((d) =>
        d.id === domainId
          ? {
              ...d,
              objectives: [
                ...d.objectives,
                {
                  id: Date.now().toString(),
                  reference_code: '',
                  name: '',
                  description: '',
                },
              ],
            }
          : d
      )
    );
  };

  const removeObjective = (domainId: string, objectiveId: string) => {
    setDomains(
      domains.map((d) =>
        d.id === domainId
          ? {
              ...d,
              objectives: d.objectives.filter((o) => o.id !== objectiveId),
            }
          : d
      )
    );
  };

  const updateObjective = (
    domainId: string,
    objectiveId: string,
    field: keyof ObjectiveInput,
    value: string
  ) => {
    setDomains(
      domains.map((d) =>
        d.id === domainId
          ? {
              ...d,
              objectives: d.objectives.map((o) =>
                o.id === objectiveId ? { ...o, [field]: value } : o
              ),
            }
          : d
      )
    );
  };

  const handleImportJson = () => {
    try {
      const parsed = JSON.parse(importJson);
      setImportError('');
      
      if (parsed.name) setName(parsed.name);
      if (parsed.version) setVersion(parsed.version);
      if (parsed.description) setDescription(parsed.description);
      if (parsed.source) setRegulator(parsed.source);
      
      if (parsed.domains && Array.isArray(parsed.domains)) {
        const importedDomains: DomainInput[] = parsed.domains.map((d: any, di: number) => ({
          id: Date.now().toString() + di,
          name: d.name || '',
          description: d.description || '',
          isExpanded: false,
          objectives: (d.control_objectives || d.objectives || []).map((o: any, oi: number) => ({
            id: Date.now().toString() + di + oi,
            reference_code: o.reference_code || o.code || '',
            name: o.name || '',
            description: o.description || '',
          })),
        }));
        setDomains(importedDomains);
      }
      
      setShowImport(false);
      setImportJson('');
    } catch (e) {
      setImportError('Invalid JSON format. Please check your input.');
    }
  };

  const handleSubmit = async () => {
    const frameworkData = {
      name,
      version,
      description,
      source: regulator,
      domains: domains.map((d, di) => ({
        name: d.name,
        description: d.description,
        order_index: di,
        control_objectives: d.objectives.map((o) => ({
          reference_code: o.reference_code,
          name: o.name,
          description: o.description,
          guidance: '',
        })),
      })),
    };

    await createMutation.mutateAsync(frameworkData);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      <div className="absolute inset-0 flex items-center justify-center p-4 md:p-6">
        <div className="flex h-[70vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary-50 p-2">
                <FileStack className="h-5 w-5 text-primary-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-black">Create Custom Framework</h2>
                <p className="text-sm text-gray-600">Define your institutional compliance framework</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-4xl space-y-6">
              <div className="flex items-center justify-end">
                <button
                  onClick={() => setShowImport(!showImport)}
                  className="btn-secondary flex items-center gap-2"
                >
                  <FileJson className="h-4 w-4" />
                  Import from JSON
                </button>
              </div>

              {showImport && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <label className="label">Paste JSON Framework Definition</label>
                  <textarea
                    value={importJson}
                    onChange={(e) => setImportJson(e.target.value)}
                    rows={6}
                    className="input resize-none font-mono text-sm"
                    placeholder='{"name": "Custom Framework", "version": "1.0", "domains": [...]}'
                  />
                  {importError && (
                    <p className="mt-2 text-sm text-red-600">{importError}</p>
                  )}
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setShowImport(false);
                        setImportJson('');
                        setImportError('');
                      }}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                    <button onClick={handleImportJson} className="btn-primary">
                      Import
                    </button>
                  </div>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Framework Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="input"
                    placeholder="e.g., Information Security Policy"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Short Code</label>
                    <input
                      type="text"
                      value={shortCode}
                      onChange={(e) => setShortCode(e.target.value)}
                      className="input"
                      placeholder="e.g., ISP"
                    />
                  </div>
                  <div>
                    <label className="label">Version *</label>
                    <input
                      type="text"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      className="input"
                      placeholder="1.0"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="label">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="input resize-none"
                  placeholder="Brief description of the framework's purpose and scope..."
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-gray-600" />
                    Regulator / Authority
                  </label>
                  <input
                    type="text"
                    value={regulator}
                    onChange={(e) => setRegulator(e.target.value)}
                    className="input"
                    placeholder="e.g., Internal, SAMA, NCA"
                  />
                </div>
                <div>
                  <label className="label flex items-center gap-2">
                    <Globe className="h-4 w-4 text-gray-600" />
                    Jurisdiction
                  </label>
                  <input
                    type="text"
                    value={jurisdiction}
                    onChange={(e) => setJurisdiction(e.target.value)}
                    className="input"
                    placeholder="e.g., Saudi Arabia, Global"
                  />
                </div>
              </div>

              <div className="border-t border-gray-200 pt-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-medium text-black">Domains & Control Objectives</h3>
                  <button onClick={addDomain} className="btn-primary flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Add Domain
                  </button>
                </div>

                {domains.length === 0 ? (
                  <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center">
                    <FileStack className="mx-auto h-12 w-12 text-gray-500" />
                    <p className="mt-2 text-gray-700">No domains defined yet</p>
                    <p className="text-sm text-gray-500">
                      Add domains to organize your control objectives
                    </p>
                    <button
                      onClick={addDomain}
                      className="btn-secondary mt-4"
                    >
                      Add First Domain
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {domains.map((domain, index) => (
                      <div
                        key={domain.id}
                        className="rounded-lg border border-gray-200 bg-white"
                      >
                        <div
                          className="flex cursor-pointer items-center gap-3 p-4"
                          onClick={() => updateDomain(domain.id, 'isExpanded', !domain.isExpanded)}
                        >
                          {domain.isExpanded ? (
                            <ChevronDown className="h-5 w-5 text-gray-600" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-gray-600" />
                          )}
                          <span className="flex h-6 w-6 items-center justify-center rounded bg-blue-50 text-xs font-bold text-blue-700">
                            {index + 1}
                          </span>
                          <div className="flex-1">
                            <input
                              type="text"
                              value={domain.name}
                              onChange={(e) => {
                                e.stopPropagation();
                                updateDomain(domain.id, 'name', e.target.value);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="input !border-0 !bg-transparent !p-0 font-medium !text-black"
                              placeholder="Domain name..."
                            />
                          </div>
                          <span className="text-xs text-gray-500">
                            {domain.objectives.length} objectives
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeDomain(domain.id);
                            }}
                            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        {domain.isExpanded && (
                          <div className="border-t border-gray-200 p-4">
                            <div className="mb-4">
                              <label className="label text-xs">Domain Description</label>
                              <input
                                type="text"
                                value={domain.description}
                                onChange={(e) =>
                                  updateDomain(domain.id, 'description', e.target.value)
                                }
                                className="input"
                                placeholder="Brief description of this domain..."
                              />
                            </div>

                            <div className="mb-3 flex items-center justify-between">
                              <label className="text-sm font-medium text-gray-700">
                                Control Objectives
                              </label>
                              <button
                                onClick={() => addObjective(domain.id)}
                                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-primary-600 hover:bg-primary-50"
                              >
                                <Plus className="h-3 w-3" />
                                Add Objective
                              </button>
                            </div>

                            {domain.objectives.length === 0 ? (
                              <p className="py-4 text-center text-sm text-gray-500">
                                No control objectives yet
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {domain.objectives.map((objective) => (
                                  <div
                                    key={objective.id}
                                    className="grid items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 md:grid-cols-[120px_minmax(0,1fr)_auto]"
                                  >
                                    <input
                                      type="text"
                                      value={objective.reference_code}
                                      onChange={(e) =>
                                        updateObjective(
                                          domain.id,
                                          objective.id,
                                          'reference_code',
                                          e.target.value
                                        )
                                      }
                                      className="input w-full text-center font-mono text-sm"
                                      placeholder="Code"
                                    />
                                    <div className="flex-1">
                                      <input
                                        type="text"
                                        value={objective.name}
                                        onChange={(e) =>
                                          updateObjective(
                                            domain.id,
                                            objective.id,
                                            'name',
                                            e.target.value
                                          )
                                        }
                                        className="input mb-2"
                                        placeholder="Objective name..."
                                      />
                                      <input
                                        type="text"
                                        value={objective.description}
                                        onChange={(e) =>
                                          updateObjective(
                                            domain.id,
                                            objective.id,
                                            'description',
                                            e.target.value
                                          )
                                        }
                                        className="input text-sm"
                                        placeholder="Description (optional)..."
                                      />
                                    </div>
                                    <button
                                      onClick={() => removeObjective(domain.id, objective.id)}
                                      className="rounded p-1 text-gray-500 hover:bg-white hover:text-red-600"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 px-6 py-4">
            <div className="mx-auto flex max-w-4xl items-center justify-end gap-4">
              <button onClick={handleClose} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!name || !version || createMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Create Framework
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
