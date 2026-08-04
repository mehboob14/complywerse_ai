'use client';

import { useRef, useState } from 'react';
import {
  Check, ChevronDown, Download, FileSpreadsheet, FileText, FileType2,
  FolderOpen, LayoutGrid, Loader2, Lock, Plus, Printer, Save, Sparkles, Table2, Trash2, Users,
} from 'lucide-react';
import type { ReportDataset, ReportSpec } from './types';
import type { ReportTemplate } from './reportTemplates';
import type { SpecSource } from './savedReports';

export default function BuilderToolbar({
  specName, onNameChange, dataset, datasets, grouped,
  specs, templates, templateCategories, specSource,
  saved, savedSource, exporting,
  shared, onToggleShared,
  onDatasetChange, onNewReport, onOpenSpec, onOpenTemplate, onDeleteSpec,
  onSave, onExport, onExitBuild,
}: {
  specName: string;
  onNameChange: (name: string) => void;
  dataset: ReportDataset;
  datasets: ReportDataset[];
  grouped: [string, ReportDataset[]][];
  specs: ReportSpec[];
  templates: ReportTemplate[];
  templateCategories: string[];
  specSource: SpecSource;
  saved: boolean;
  savedSource: SpecSource;
  exporting: boolean;
  shared: boolean;
  onToggleShared: () => void;
  onDatasetChange: (key: string) => void;
  onNewReport: () => void;
  onOpenSpec: (s: ReportSpec) => void;
  onOpenTemplate: (t: ReportTemplate) => void;
  onDeleteSpec: (id: string) => void;
  onSave: () => void;
  onExport: (kind: 'pdf' | 'excel' | 'csv' | 'word') => void;
  onExitBuild: () => void;
}) {
  const [libOpen, setLibOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  return (
    <header className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5">
      <button
        type="button"
        onClick={onExitBuild}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        <Table2 className="h-3.5 w-3.5" /> Explore
      </button>

      <div className="relative" ref={wrap}>
        <button
          type="button"
          onClick={() => setLibOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <FolderOpen className="h-3.5 w-3.5" /> Library <ChevronDown className="h-3 w-3 text-slate-400" />
        </button>
        {libOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setLibOpen(false)} />
            <div className="absolute left-0 top-full z-40 mt-1 flex max-h-[min(70vh,480px)] w-80 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <span className="text-xs font-semibold text-slate-800">Reports library</span>
                <button type="button" onClick={() => { onNewReport(); setLibOpen(false); }} className="inline-flex items-center gap-1 rounded-md bg-primary-500 px-2 py-1 text-[11px] font-semibold text-[#0a0a0a] hover:bg-primary-600">
                  <Plus className="h-3 w-3" /> New
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {specs.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Saved</p>
                    {specs.map((s) => (
                      <div key={s.id} className="group mb-0.5 flex items-center gap-1 rounded-lg hover:bg-slate-50">
                        <button type="button" onClick={() => { onOpenSpec(s); setLibOpen(false); }} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm text-slate-700">
                          {s.name || 'Untitled report'}
                          {s.shared && <Users className="ml-1 inline h-3 w-3 text-slate-400" />}
                        </button>
                        {s.mine !== false && (
                          <button type="button" onClick={() => onDeleteSpec(s.id)} className="rounded p-1 text-slate-300 opacity-0 hover:text-rose-600 group-hover:opacity-100">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {specSource === 'local' && (
                      <p className="px-1 pt-1 text-[10px] text-amber-600">Saved locally only</p>
                    )}
                  </div>
                )}
                {templates.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1 flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      <Sparkles className="h-3 w-3" /> Templates
                    </p>
                    {templateCategories.map((cat) => {
                      const list = templates.filter((t) => t.category === cat);
                      if (!list.length) return null;
                      return (
                        <div key={cat} className="mb-1.5">
                          <p className="px-1 text-[10px] text-slate-400">{cat}</p>
                          {list.map((t) => (
                            <button key={t.id} type="button" title={t.description} onClick={() => { onOpenTemplate(t); setLibOpen(false); }}
                              className="mb-0.5 block w-full truncate rounded-lg px-2 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50">
                              {t.name}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div>
                  <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Datasets</p>
                  {grouped.map(([mod, list]) => (
                    <div key={mod} className="mb-2">
                      <p className="px-1 text-[10px] font-medium text-slate-400">{mod}</p>
                      {list.map((d) => (
                        <button key={d.key} type="button" onClick={() => { onDatasetChange(d.key); setLibOpen(false); }}
                          className={`mb-0.5 block w-full rounded-lg px-2 py-1.5 text-left text-sm ${d.key === dataset.key ? 'bg-primary-50 font-semibold text-primary-700' : 'text-slate-700 hover:bg-slate-50'}`}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <select
        value={dataset.key}
        onChange={(e) => onDatasetChange(e.target.value)}
        className="hidden max-w-[200px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 sm:block"
      >
        {datasets.map((d) => <option key={d.key} value={d.key}>{d.module} · {d.label}</option>)}
      </select>

      <span className="hidden items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 md:inline-flex">
        <LayoutGrid className="h-3 w-3" /> {dataset.label}
      </span>

      <div className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />

      <input
        value={specName}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Untitled report"
        className="min-w-[120px] flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 hover:border-slate-200 focus:border-primary-500 focus:bg-white focus:outline-none"
      />

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <button type="button" onClick={() => setExportOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export
          </button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setExportOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                <button type="button" onClick={() => { onExport('pdf'); setExportOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"><Printer className="h-4 w-4 text-rose-600" /> PDF</button>
                <button type="button" onClick={() => { onExport('excel'); setExportOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Excel</button>
                <button type="button" onClick={() => { onExport('word'); setExportOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"><FileType2 className="h-4 w-4 text-sky-700" /> Word</button>
                <button type="button" onClick={() => { onExport('csv'); setExportOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"><FileText className="h-4 w-4 text-slate-500" /> CSV</button>
              </div>
            </>
          )}
        </div>
        <button type="button" onClick={onToggleShared} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${shared ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
          {shared ? <Users className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />} {shared ? 'Shared' : 'Private'}
        </button>
        <button type="button" onClick={onSave} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600">
          {saved ? <><Check className="h-3.5 w-3.5" strokeWidth={3} /> Saved</> : <><Save className="h-3.5 w-3.5" /> Save</>}
        </button>
      </div>
    </header>
  );
}
