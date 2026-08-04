'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { Search, Loader2, FileText, X, ChevronDown, Check, ArrowLeft, Shield } from 'lucide-react';

export interface NcaTemplateMeta {
  id: string;
  filename: string;
  title: string;
  category: string;
}

interface Props {
  value: string | null;
  onChange: (templateId: string | null, template: NcaTemplateMeta | null) => void;
  label?: string;
  placeholder?: string;
}

// Source registry — extend later (UBL, ISO, internal libraries, etc.) and the
// two-step picker UI will pick up new entries automatically.
type SourceId = 'nca';
interface Source {
  id: SourceId;
  label: string;
  description: string;
  icon: typeof Shield;
}
const SOURCES: Source[] = [
  {
    id: 'nca',
    label: 'NCA Template',
    description: 'Saudi NCA cybersecurity templates (policies, standards, procedures…)',
    icon: Shield,
  },
];

/**
 * Two-step template picker.
 *   Step 1 — pick a template source (NCA, …)
 *   Step 2 — search + select a specific template within that source
 */
export default function NcaTemplateSelect({
  value,
  onChange,
  label = 'Templates',
  placeholder = 'Select a template…',
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeSource, setActiveSource] = useState<SourceId | null>(null);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: catalog, isLoading } = useQuery<{ templates: NcaTemplateMeta[]; total: number }>({
    queryKey: ['nca-templates-catalog'],
    queryFn: async () => (await apiClient.get('/governance/nca-templates')).data,
    staleTime: 5 * 60_000,
    enabled: open && activeSource === 'nca',
  });

  // Close + reset on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveSource(null);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const templates = catalog?.templates || [];
  const selected = useMemo(
    () => templates.find(t => t.id === value) || null,
    [templates, value]
  );

  const filtered = useMemo(() => {
    if (!search) return templates;
    const q = search.toLowerCase();
    return templates.filter(t =>
      t.title.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
    );
  }, [templates, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, NcaTemplateMeta[]>();
    filtered.forEach(t => {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const closePicker = () => {
    setOpen(false);
    setActiveSource(null);
    setSearch('');
  };

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block text-sm font-medium text-gray-800 mb-1">
          {label}
        </label>
      )}

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-left text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 hover:border-gray-400"
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected ? (
            <>
              <FileText className="h-4 w-4 text-blue-600 flex-shrink-0" />
              <span className="truncate">{selected.title}</span>
              <span className="text-xs text-gray-500 flex-shrink-0">— {selected.category}</span>
            </>
          ) : (
            <span className="text-gray-400">{placeholder}</span>
          )}
        </span>
        <span className="flex items-center gap-1 flex-shrink-0">
          {selected && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange(null, null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onChange(null, null); } }}
              className="p-0.5 rounded hover:bg-gray-100 inline-flex items-center justify-center cursor-pointer"
              title="Clear selection"
            >
              <X className="h-3.5 w-3.5 text-gray-400" />
            </span>
          )}
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="absolute z-[70] mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-2xl max-h-96 overflow-hidden flex flex-col">
          {/* Step 1 — pick a source */}
          {activeSource === null && (
            <div className="overflow-y-auto">
              {SOURCES.map((src) => {
                const Icon = src.icon;
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => setActiveSource(src.id)}
                    className="w-full text-left px-3 py-3 hover:bg-blue-50 flex items-start gap-3 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <Icon className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{src.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{src.description}</p>
                    </div>
                    <ChevronDown className="h-4 w-4 text-gray-400 -rotate-90 flex-shrink-0 mt-1" />
                  </button>
                );
              })}
            </div>
          )}

          {/* Step 2 — search + pick a template within the source */}
          {activeSource === 'nca' && (
            <>
              <div className="p-2 border-b border-gray-100 sticky top-0 bg-white flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setActiveSource(null); setSearch(''); }}
                  className="p-1 rounded hover:bg-gray-100 flex-shrink-0"
                  title="Back"
                >
                  <ArrowLeft className="h-4 w-4 text-gray-500" />
                </button>
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    autoFocus
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={`Search ${catalog?.total ?? ''} NCA templates…`}
                    className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="overflow-y-auto flex-1">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                  </div>
                ) : grouped.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-6">No templates match</p>
                ) : (
                  grouped.map(([category, items]) => (
                    <div key={category}>
                      <div className="px-3 py-1 bg-gray-50 text-xs font-semibold text-gray-600 sticky top-0">
                        {category} ({items.length})
                      </div>
                      {items.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            onChange(t.id, t);
                            closePicker();
                          }}
                          className={`w-full text-left px-3 py-2 hover:bg-blue-50 flex items-start gap-2 ${
                            value === t.id ? 'bg-blue-50' : ''
                          }`}
                        >
                          <FileText className="h-3.5 w-3.5 text-blue-600 flex-shrink-0 mt-0.5" />
                          <span className="text-xs text-gray-800 flex-1 leading-snug">{t.title}</span>
                          {value === t.id && <Check className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />}
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
