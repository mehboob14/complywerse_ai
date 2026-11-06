'use client';

/** Add custom fields from a template instead of typing each one.
 *
 *  The person uploads the sheet, CSV or document their organisation already uses. AI reads it and proposes the
 *  fields; only fields the file holds come back, each with where it was found and an example value. They check
 *  them (rename, retype, edit a dropdown's options, untick what they do not want) and add them in one click.
 *  Nothing is saved until "Add". The file is read on the server and not kept.
 *
 *  Sits in the shared fields editor, so every module that has custom fields gets it.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, FileUp, Loader2, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import apiClient from '@/lib/api';
import { AnimatedModal, useToast } from '@/components/ui';
import type { ModuleSettings } from './CustomFields';

type Suggestion = {
  label: string; type: string; required: boolean; options: string[]; help: string;
  where: string; example: string; confidence: number | null;
  status: 'new' | 'exists'; exists_as: string | null; key?: string;
};
type Suggestions = {
  file: { name: string; kind: string; sheets: string[]; headings: number };
  by: 'ai' | 'rules'; fields: Suggestion[]; left_out: { label: string; reason: string }[]; notes: string[];
};
type Row = Suggestion & { id: number; selected: boolean; optionsText: string };
type Imported = {
  settings: ModuleSettings; added: { key: string; label: string; type: string }[]; skipped: { label: string; reason: string }[];
};

const ACCEPT = '.xlsx,.xlsm,.xlsb,.xls,.ods,.csv,.tsv,.docx,.pdf';
const TYPES: Array<[string, string]> = [
  ['text', 'Short text'], ['textarea', 'Long text'], ['number', 'Number'], ['date', 'Date'],
  ['select', 'Dropdown'], ['multiselect', 'Multi-select'], ['checkbox', 'Yes / no'], ['user', 'Person'],
];
const input = 'w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none';

const messageOf = (e: unknown, fallback: string) => {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};
const isDropdown = (type: string) => type === 'select' || type === 'multiselect';
const optionList = (text: string) => Array.from(new Set(text.split('\n').map((o) => o.trim()).filter(Boolean)));

export default function ImportFieldsFromTemplate({ moduleKey }: { moduleKey: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<Suggestions | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [showExisting, setShowExisting] = useState(false);
  const [showLeftOut, setShowLeftOut] = useState(false);

  const reset = () => { setResult(null); setRows([]); setShowExisting(false); setShowLeftOut(false); suggest.reset(); add.reset(); };
  const close = () => { setOpen(false); reset(); };

  const suggest = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return (await apiClient.post(`/module-settings/${moduleKey}/fields/suggest`, form,
        { headers: { 'Content-Type': 'multipart/form-data' } })).data as Suggestions;
    },
    onSuccess: (data) => {
      setResult(data);
      setRows(data.fields.map((f, i) => ({ ...f, id: i, selected: f.status === 'new', optionsText: (f.options || []).join('\n') })));
    },
  });

  const chosen = rows.filter((r) => r.selected && r.status === 'new' && r.label.trim());
  const add = useMutation({
    mutationFn: async () => (await apiClient.post(`/module-settings/${moduleKey}/fields/import`, {
      fields: chosen.map((r) => ({
        label: r.label.trim(), type: r.type, required: r.required, help: r.help,
        options: isDropdown(r.type) ? optionList(r.optionsText) : [],
      })),
    })).data as Imported,
    onSuccess: (data) => {
      qc.setQueryData(['module-settings', moduleKey], data.settings);   // the key CustomFields.tsx reads the form from
      const n = data.added.length;
      toast({
        type: n ? 'success' : 'info',
        title: n ? `Added ${n} custom field${n === 1 ? '' : 's'}` : 'Nothing new to add',
        message: data.skipped.length ? `${data.skipped.length} already on the form` : undefined,
      });
      close();
    },
  });

  const pick = (file?: File | null) => { if (file) suggest.mutate(file); };
  const patch = (id: number, change: Partial<Row>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...change } : r)));
  const fresh = rows.filter((r) => r.status === 'new');
  const existing = rows.filter((r) => r.status === 'exists');
  const allOn = fresh.length > 0 && fresh.every((r) => r.selected);
  const reading = suggest.isPending;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="ml-3 mr-auto inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
        <Sparkles className="h-3 w-3" /> Import from template
      </button>

      <AnimatedModal
        isOpen={open} onClose={close} size="lg"
        title={<span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-blue-600" /> Add fields from a template</span>}
        subtitle="Upload a sheet, CSV or document. AI suggests the fields in it; you check and add them."
        footer={result ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={reset} className="text-sm font-medium text-slate-600 hover:underline">Choose another file</button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={close}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => add.mutate()} disabled={add.isPending || chosen.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {add.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {chosen.length === 0 ? 'Add fields' : `Add ${chosen.length} field${chosen.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        ) : undefined}
      >
        {!result ? (
          <div className="p-5">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center ${dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50'}`}>
              {reading ? (
                <>
                  <Loader2 className="mb-2 h-8 w-8 animate-spin text-blue-600" />
                  <p className="text-sm font-medium text-slate-800">AI is reading your template…</p>
                  <p className="mt-1 text-xs text-slate-500">This can take up to a minute for a long document.</p>
                </>
              ) : (
                <>
                  <FileUp className="mb-2 h-8 w-8 text-slate-400" />
                  <p className="text-sm font-medium text-slate-800">Drop a file here, or</p>
                  <button type="button" onClick={() => fileInput.current?.click()}
                    className="mt-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">Choose a file</button>
                  <p className="mt-2 text-xs text-slate-500">Excel (.xlsx), CSV, Word (.docx) or PDF, up to 5 MB</p>
                </>
              )}
              <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" aria-label="Template file"
                onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            {suggest.isError && (
              <p className="mt-3 flex items-start gap-1.5 text-sm text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {messageOf(suggest.error, 'This file could not be read.')}
              </p>
            )}
            <ul className="mt-4 space-y-1 text-xs text-slate-500">
              <li>AI only suggests fields that are in your file, and says where it found each one.</li>
              <li>It reads the column names, form labels and a few sample values, not your rows. The file is not kept.</li>
              <li>Nothing is added until you confirm.</li>
            </ul>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold text-slate-900">
                {fresh.length} new field{fresh.length === 1 ? '' : 's'}
              </span>
              <span className="text-slate-500">in {result.file.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${result.by === 'ai' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                {result.by === 'ai' ? 'Suggested by AI' : 'From the file’s headings'}
              </span>
              {fresh.length > 1 && (
                <button type="button" className="ml-auto text-xs font-medium text-blue-700 hover:underline"
                  onClick={() => setRows(rows.map((r) => (r.status === 'new' ? { ...r, selected: !allOn } : r)))}>
                  {allOn ? 'Select none' : 'Select all'}
                </button>
              )}
            </div>
            {result.notes.map((n) => (
              <p key={n} className="flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {n}
              </p>
            ))}
            {add.isError && (
              <p className="flex items-start gap-1.5 text-sm text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {messageOf(add.error, 'Could not add the fields.')}
              </p>
            )}

            <div className="space-y-2">
              {fresh.map((r) => (
                <div key={r.id} className={`rounded-lg border p-3 ${r.selected ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={r.selected} aria-label={`Add ${r.label}`} className="mt-2"
                      onChange={(e) => patch(r.id, { selected: e.target.checked })} />
                    <div className="min-w-0 flex-1">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.5fr_1fr_auto]">
                        <input className={input} value={r.label} aria-label="Field name" onChange={(e) => patch(r.id, { label: e.target.value })} />
                        <select className={input} value={r.type} aria-label="Field type" onChange={(e) => patch(r.id, { type: e.target.value })}>
                          {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <label className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-600">
                          <input type="checkbox" checked={r.required} onChange={(e) => patch(r.id, { required: e.target.checked })} /> Required
                        </label>
                      </div>
                      <p className="mt-1.5 text-[11px] text-slate-500">
                        Found in {r.where}{r.example ? <> · e.g. <span className="text-slate-700">{r.example}</span></> : null}
                      </p>
                      {isDropdown(r.type) && (
                        <div className="mt-2">
                          <textarea className={input} rows={Math.min(6, Math.max(2, r.optionsText.split('\n').length))}
                            value={r.optionsText} aria-label="Dropdown options, one per line" placeholder="One option per line"
                            onChange={(e) => patch(r.id, { optionsText: e.target.value })} />
                          {r.selected && optionList(r.optionsText).length === 0 && (
                            <p className="mt-1 text-[11px] text-amber-700">Add at least one option, or this is added as short text.</p>
                          )}
                        </div>
                      )}
                      {r.help && <p className="mt-1.5 text-[11px] text-slate-500">Help text from the file: {r.help}</p>}
                    </div>
                  </div>
                </div>
              ))}
              {fresh.length === 0 && (
                <p className="rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-600">Everything in this file is already on the form.</p>
              )}
            </div>

            {existing.length > 0 && (
              <div>
                <button type="button" onClick={() => setShowExisting(!showExisting)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900">
                  {showExisting ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Already on this form ({existing.length})
                </button>
                {showExisting && (
                  <ul className="mt-1.5 space-y-0.5 pl-5 text-xs text-slate-500">
                    {existing.map((r) => <li key={r.id}>{r.label}{r.exists_as && r.exists_as !== r.label ? ` → ${r.exists_as}` : ''}</li>)}
                  </ul>
                )}
              </div>
            )}
            {result.left_out.length > 0 && (
              <div>
                <button type="button" onClick={() => setShowLeftOut(!showLeftOut)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900">
                  {showLeftOut ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Left out ({result.left_out.length})
                </button>
                {showLeftOut && (
                  <ul className="mt-1.5 space-y-0.5 pl-5 text-xs text-slate-500">
                    {result.left_out.map((l, i) => <li key={`${l.label}-${i}`}>{l.label || '(blank heading)'}{l.reason ? ` — ${l.reason}` : ''}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </AnimatedModal>
    </>
  );
}
