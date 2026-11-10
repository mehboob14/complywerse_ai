'use client';

// Import observations with AI, in three steps on the kit's sheet: 1 hints and the file (what is read of a long document is said BEFORE it is sent), 2 the AI reads it (progress, and a way to
// stop waiting: nothing is saved either way), 3 the drafts for the person to check (confidence, "already registered" flags, every field editable) before anything is created. The AI's
// failures are said in plain words by the server; a draft that repeats a registered observation starts unticked. Nothing is saved until "Create".
import { useId, useRef, useState } from 'react';
import { FileUp, Sparkles, Upload, X } from 'lucide-react';
import { Button, Checkbox, FormField, IconButton, Notice, Select, Sheet, StatusPill, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { statutoryAuditApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { observationPriority, observationType } from '@/lib/statuses/statutory';
import { IMPORT_EXTENSIONS, MAX_MB, acceptOf, fileProblem, readNotice, sizeText } from './files';
import { REFRESH, parseDocument, type Draft, type ParseAnswer } from './observationData';
import { PRIORITIES, TYPES } from './observationModel';

const ROW3 = 'grid gap-[12px] sm:grid-cols-3';
const LOW_CONFIDENCE = 0.6;

export function ImportSheet({ categories, onClose }: { categories: string[]; onClose: () => void }) {
  const ids = useId();
  const pick = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [hints, setHints] = useState({ regulator: '', period: '', category: '' });
  const [answer, setAnswer] = useState<ParseAnswer | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [batchCategory, setBatchCategory] = useState('');
  const [dragging, setDragging] = useState(false);

  const read = useReportedMutation({
    mutationFn: async (f: File) => {
      abort.current = new AbortController();
      return parseDocument(f, hints, abort.current.signal);
    },
    failure: "Couldn't read the document",
    toast: 'none',                                                              // said in the sheet, where the person is looking
    onSuccess: (a) => {
      setAnswer(a);
      setDrafts(a.draft_observations.map((d) => ({ ...d, selected: d.selected !== false, category: (d.category || a.category || hints.category || '').trim() || null })));
      setBatchCategory((a.category || hints.category || '').trim());
    },
  });
  const create = useReportedMutation({
    mutationFn: async () => (await statutoryAuditApi.confirmImport({ observations: drafts as unknown as Array<Record<string, unknown>>, source_document_name: answer?.source_file, import_batch_id: answer?.import_batch_id, default_category: batchCategory.trim() || undefined })).data as { count: number },
    success: (r) => `${formatCount(r.count)} ${r.count === 1 ? 'observation' : 'observations'} registered`,
    failure: "Couldn't register the observations",
    toast: 'success',
    retryable: false,
    invalidate: REFRESH,
    onSuccess: onClose,
  });

  const choose = (f: File | null) => {
    read.reset();
    if (!f) { setFile(null); setProblem(null); return; }
    const why = fileProblem(f, 'import');
    setProblem(why);
    setFile(why ? null : f);
  };
  const stop = () => { abort.current?.abort(); read.reset(); };           // the request is cancelled: nothing was saved
  const edit = (i: number, patch: Partial<Draft>) => setDrafts((all) => all.map((d, at) => (at === i ? { ...d, ...patch } : d)));
  const picked = drafts.filter((d) => d.selected && d.title.trim()).length;
  const reviewing = answer !== null;
  const reading = read.isPending;
  const cut = readNotice(answer);
  const readError = read.isError && !(read.error as { code?: string })?.code?.includes('CANCELED') ? errorMessage(read.error) : null;

  return (
    <Sheet
      open
      onClose={onClose}
      dirty={reviewing && drafts.length > 0}
      width="lg"
      title="Import with AI"
      subtitle={reviewing ? `Check what the AI found in ${answer!.source_file} before anything is saved` : 'The AI drafts observations from a circular, report or letter; you check them first'}
      footer={reviewing ? (
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <Button onClick={() => { setAnswer(null); setDrafts([]); read.reset(); create.reset(); }}>Back to the file</Button>
          <div className="flex items-center gap-[8px]">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={create.isPending} disabled={picked === 0} onClick={() => create.mutate()}>
              {picked === 1 ? 'Register 1 observation' : `Register ${formatCount(picked)} observations`}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={reading ? stop : onClose}>{reading ? 'Stop waiting' : 'Cancel'}</Button>
          <Button variant="primary" leftIcon={<Sparkles aria-hidden />} loading={reading} disabled={!file} onClick={() => file && read.mutate(file)}>Read the document</Button>
        </div>
      )}
    >
      {!reviewing ? (
        <div className="flex flex-col gap-[16px]">
          <p className="text-ds-body text-ds-fg-body">Nothing is saved until you check the list and register it. Long documents are read in part: the first 20 pages of a PDF, and about the first 14,000 characters of any file.</p>
          <div className={ROW3}>
            <FormField label="Regulator" optional><TextInput value={hints.regulator} disabled={reading} onChange={(e) => setHints((h) => ({ ...h, regulator: e.target.value }))} placeholder="SBP, SAMA" /></FormField>
            <FormField label="Period" optional><TextInput value={hints.period} disabled={reading} onChange={(e) => setHints((h) => ({ ...h, period: e.target.value }))} placeholder="FY2025" /></FormField>
            <FormField label="Category" optional>
              <TextInput list={`${ids}-cats`} value={hints.category} disabled={reading} autoComplete="off" onChange={(e) => setHints((h) => ({ ...h, category: e.target.value }))} placeholder="IFPD circular" />
              <datalist id={`${ids}-cats`}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </FormField>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); if (!reading) choose(e.dataTransfer.files?.[0] ?? null); }}
            className={`flex flex-col items-center gap-[8px] rounded-ds-card border-2 border-dashed p-[24px] text-center ${dragging ? 'border-ds-primary bg-ds-primary-soft' : problem ? 'border-ds-danger-border bg-ds-danger-soft' : 'border-ds-border-strong bg-ds-surface-subtle'}`}
          >
            <input ref={pick} type="file" className="sr-only" tabIndex={-1} accept={acceptOf(IMPORT_EXTENSIONS)} aria-label="Choose a document" disabled={reading} onChange={(e) => { choose(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            {file ? (
              <>
                <FileUp aria-hidden className="h-[28px] w-[28px] text-ds-primary-text" />
                <p className="break-all text-ds-body font-[600] text-ds-fg">{file.name}</p>
                <p className="text-ds-label text-ds-fg-muted">{sizeText(file.size)}</p>
                <Button variant="link" disabled={reading} onClick={() => choose(null)}>Choose another file</Button>
              </>
            ) : (
              <>
                <Upload aria-hidden className="h-[28px] w-[28px] text-ds-fg-muted" />
                <p className="text-ds-body font-[600] text-ds-fg">Drop a document here</p>
                <Button variant="primary" onClick={() => pick.current?.click()}>Choose a file</Button>
                <p className="max-w-[26rem] text-ds-label text-ds-fg-muted">PDF, Word, Excel, CSV or plain text, up to {MAX_MB} MB.</p>
              </>
            )}
          </div>
          {problem && <Notice tone="danger">{problem}</Notice>}
          {reading && <Notice tone="info" title="The AI is reading the document">This can take a minute or two for a long file. You can stop waiting at any time; nothing is saved.</Notice>}
          {readError && <Notice tone="danger" title="The document wasn't read">{readError}</Notice>}
        </div>
      ) : (
        <div className="flex flex-col gap-[12px]">
          {cut && <Notice tone="warning" title="Only part of the document was read">{cut}</Notice>}
          {create.isError && <Notice tone="danger" title="The observations weren't registered">{errorMessage(create.error)} Nothing is lost: register again.</Notice>}
          <div className="flex flex-wrap items-end gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
            <FormField label="Category for every draft" optional className="min-w-[200px] flex-1">
              <TextInput list={`${ids}-cats2`} value={batchCategory} autoComplete="off" onChange={(e) => setBatchCategory(e.target.value)} />
              <datalist id={`${ids}-cats2`}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </FormField>
            <Button onClick={() => setDrafts((all) => all.map((d) => ({ ...d, category: batchCategory.trim() || null })))}>Apply to all</Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <p className="text-ds-body text-ds-fg-body"><span className="font-[600] text-ds-fg">{formatCount(drafts.length)}</span> {drafts.length === 1 ? 'draft' : 'drafts'}, <span className="font-[600] text-ds-fg">{formatCount(picked)}</span> ticked</p>
            <span className="flex gap-[4px]">
              <Button variant="link" onClick={() => setDrafts((all) => all.map((d) => ({ ...d, selected: true })))}>Tick all</Button>
              <Button variant="link" onClick={() => setDrafts((all) => all.map((d) => ({ ...d, selected: false })))}>Untick all</Button>
            </span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-[12px] p-0">
            {drafts.map((d, i) => (
              <li key={i} className={`rounded-ds-card border p-[12px] ${d.selected ? 'border-ds-border bg-ds-surface' : 'border-ds-border bg-ds-surface-subtle'}`}>
                <div className="flex items-start gap-[8px]">
                  <Checkbox aria-label={`Register draft ${i + 1}`} checked={d.selected} onChange={(e) => edit(i, { selected: e.target.checked })} className="mt-[8px]" />
                  <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
                    {(d.duplicate_of || (typeof d.confidence === 'number' && d.confidence < LOW_CONFIDENCE)) && (
                      <div className="flex flex-wrap gap-[6px]">
                        {d.duplicate_of && <StatusPill size="sm" tone="warning" label={`Already registered${d.duplicate_of.code ? ` as ${d.duplicate_of.code}` : ''}`} />}
                        {typeof d.confidence === 'number' && d.confidence < LOW_CONFIDENCE && <StatusPill size="sm" tone="warning" label="The AI is not sure: check it" />}
                      </div>
                    )}
                    <FormField label="Title"><TextInput value={d.title} maxLength={500} onChange={(e) => edit(i, { title: e.target.value })} /></FormField>
                    <FormField label="Description" optional><Textarea rows={2} value={d.description ?? ''} onChange={(e) => edit(i, { description: e.target.value })} /></FormField>
                    <div className={ROW3}>
                      <FormField label="Type"><Select value={d.observation_type} onChange={(e) => edit(i, { observation_type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{observationType.label(t)}</option>)}</Select></FormField>
                      <FormField label="Priority"><Select value={d.priority} onChange={(e) => edit(i, { priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{observationPriority.label(p)}</option>)}</Select></FormField>
                      <FormField label="Category" optional><TextInput list={`${ids}-cats2`} value={d.category ?? ''} autoComplete="off" onChange={(e) => edit(i, { category: e.target.value })} /></FormField>
                      <FormField label="Regulator" optional><TextInput value={d.regulator_source ?? ''} onChange={(e) => edit(i, { regulator_source: e.target.value })} /></FormField>
                      <FormField label="Reference" optional><TextInput value={d.regulation_reference ?? ''} onChange={(e) => edit(i, { regulation_reference: e.target.value })} /></FormField>
                    </div>
                  </div>
                  <IconButton label={`Remove draft ${i + 1}`} onClick={() => setDrafts((all) => all.filter((_, at) => at !== i))}><X aria-hidden /></IconButton>
                </div>
              </li>
            ))}
          </ul>
          {drafts.length === 0 && <Notice tone="warning" title="Every draft was removed">Go back to the file to read it again, or register an observation by hand.</Notice>}
        </div>
      )}
    </Sheet>
  );
}
