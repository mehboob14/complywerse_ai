'use client';

/**
 * What the document must respect, whatever is asked in the chat: the organisation's name (used exactly, and checked for),
 * the logo that goes in the header of an exported document, what to focus on, the tone and language, and required items the
 * AI must meet and report on. Saved as you type.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, Star, Trash2, Upload, X } from 'lucide-react';
import { problemOf, studioApi, type Instructions, type Session } from '@/lib/studio/api';
import { useToast } from '@/components/ui/ToastProvider';
import AssetImage from './AssetImage';

const LANGUAGES: { value: string; label: string }[] = [
  { value: '', label: 'As the document is written' },
  { value: 'en-GB', label: 'English (UK spelling)' },
  { value: 'en-US', label: 'English (US spelling)' },
  { value: 'Arabic', label: 'Arabic' },
  { value: 'Urdu', label: 'Urdu' },
  { value: 'French', label: 'French' },
];

const TONES = ['Formal and precise', 'Plain English', 'Directive (“shall”, “must”)', 'Concise'];

const inputClass = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#1f2933] placeholder:text-[#7b8794] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-[#26323d]">{label}</span>
      {hint && <span className="mt-0.5 block text-[11px] text-[#586472]">{hint}</span>}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

export default function InstructionsPanel({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const ins = session.instructions;
  const [draft, setDraft] = useState<Instructions>(ins);
  const [newReq, setNewReq] = useState('');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const file = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);

  // the session changed elsewhere (a reload): take it, unless the person is mid-edit
  useEffect(() => { if (!dirty.current) setDraft(session.instructions); }, [session.instructions]);

  const save = useMutation({
    mutationFn: (body: Instructions) => studioApi.patchSession(session.id, { instructions: body }),
    onMutate: () => setSaved('saving'),
    onSuccess: () => { setSaved('saved'); dirty.current = false; onChanged(); },
    onError: (e) => { setSaved('idle'); toast({ title: 'Could not save the instructions', message: problemOf(e), type: 'error' }); },
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = (patch: Instructions, immediately = false) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    if (immediately) save.mutate(patch);
    else timer.current = setTimeout(() => save.mutate(patch), 800);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const assets = useQuery({ queryKey: ['studio', 'assets'], queryFn: studioApi.assets, staleTime: 30_000 });
  const upload = useMutation({
    mutationFn: (f: File) => studioApi.uploadAsset(f, !(assets.data?.items.length)),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ['studio', 'assets'] }); change({ logo_asset_id: a.id }, true); },
    onError: (e) => toast({ title: 'That logo could not be used', message: problemOf(e), type: 'error' }),
  });
  const makeDefault = useMutation({
    mutationFn: (id: number) => studioApi.updateAsset(id, { is_default: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio', 'assets'] }),
    onError: (e) => toast({ title: 'Could not change the default logo', message: problemOf(e), type: 'error' }),
  });
  const removeAsset = useMutation({
    mutationFn: (id: number) => studioApi.deleteAsset(id),
    onSuccess: (_r, id) => { qc.invalidateQueries({ queryKey: ['studio', 'assets'] }); if (draft.logo_asset_id === id) change({ logo_asset_id: null }, true); },
    onError: (e) => toast({ title: 'Could not remove the logo', message: problemOf(e), type: 'error' }),
  });

  const requirements = draft.requirements ?? [];
  const [otherLanguage, setOtherLanguage] = useState(() => !LANGUAGES.some((l) => l.value === (ins.language ?? '')));
  const languageValue = otherLanguage ? 'other' : (draft.language ?? '');

  return (
    <div className="h-full space-y-4 overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[#1f2933]">Instructions</h3>
          <p className="mt-0.5 text-xs text-[#586472]">The AI follows these in every answer, and the checks verify them.</p>
        </div>
        <span className="text-[11px] text-[#586472]" role="status">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? <span className="inline-flex items-center gap-1 text-[#0a5a38]"><Check className="h-3 w-3" /> Saved</span> : ''}</span>
      </div>

      <Field label="Entity name" hint="Used exactly wherever the organisation is named. The checks warn when it is missing or a placeholder stands in for it.">
        <input value={draft.entity_name ?? ''} onChange={(e) => change({ entity_name: e.target.value })} placeholder="e.g. Capital Financial Services Bank" className={inputClass} />
      </Field>

      <div>
        <p className="text-xs font-semibold text-[#26323d]">Logo</p>
        <p className="mt-0.5 text-[11px] text-[#586472]">Goes in the header of an exported Word or PDF document, next to the entity name. PNG or JPEG.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {assets.data?.items.map((a) => {
            const on = draft.logo_asset_id === a.id;
            return (
              <div key={a.id} className={`group relative flex h-16 w-28 items-center justify-center rounded-lg border bg-white p-1.5 ${on ? 'border-[#0f766e] ring-2 ring-[#1ed4b0]' : 'border-[#c5ccd3]'}`}>
                <button type="button" onClick={() => change({ logo_asset_id: on ? null : a.id }, true)} aria-pressed={on} aria-label={`${on ? 'Stop using' : 'Use'} the logo ${a.name}`} className="absolute inset-0 rounded-lg" />
                <AssetImage id={a.id} alt={a.name} className="max-h-full max-w-full object-contain" />
                {on && <span className="absolute right-1 top-1 rounded-full bg-[#0f766e] p-0.5 text-white"><Check className="h-3 w-3" /></span>}
                <span className="absolute inset-x-0 bottom-0 hidden items-center justify-between rounded-b-lg bg-white/95 px-1 py-0.5 group-hover:flex group-focus-within:flex">
                  <button type="button" onClick={() => makeDefault.mutate(a.id)} title={a.is_default ? 'The default for new documents' : 'Make the default for new documents'} aria-label={`Make ${a.name} the default`} className="relative z-10 rounded p-0.5 text-[#8a6100] hover:bg-[#fff2a8]"><Star className={`h-3.5 w-3.5 ${a.is_default ? 'fill-current' : ''}`} /></button>
                  <button type="button" onClick={() => removeAsset.mutate(a.id)} title="Delete this logo" aria-label={`Delete ${a.name}`} className="relative z-10 rounded p-0.5 text-[#9b1c1c] hover:bg-[#fdf3f3]"><Trash2 className="h-3.5 w-3.5" /></button>
                </span>
              </div>
            );
          })}
          <input ref={file} type="file" hidden accept="image/png,image/jpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
          <button type="button" onClick={() => file.current?.click()} disabled={upload.isPending} className="flex h-16 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#7b8794] bg-white text-xs font-medium text-[#3f4b58] hover:border-[#0f766e] hover:bg-[#f3fbf9] disabled:opacity-50">
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload a logo
          </button>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-[#26323d]">
            <input type="checkbox" checked={!!draft.logo_required} onChange={(e) => change({ logo_required: e.target.checked }, true)} className="accent-[#0f766e]" /> A logo is required
          </label>
          <label className="flex items-center gap-2 text-sm text-[#26323d]">
            Position
            <select value={draft.logo_position ?? 'header-left'} onChange={(e) => change({ logo_position: e.target.value as Instructions['logo_position'] }, true)} className="rounded border border-[#b8c4c8] bg-white px-2 py-1 text-sm">
              <option value="header-left">Header, left</option>
              <option value="header-center">Header, centre</option>
              <option value="header-right">Header, right</option>
            </select>
          </label>
        </div>
      </div>

      <Field label="Focus areas" hint="Anything the AI should give particular attention to, in your own words.">
        <textarea value={draft.focus_areas ?? ''} onChange={(e) => change({ focus_areas: e.target.value })} rows={3} placeholder="e.g. Remote working, third-party access, evidence the auditors will ask for" className={inputClass} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tone">
          <input list="studio-tones" value={draft.tone ?? ''} onChange={(e) => change({ tone: e.target.value })} placeholder="e.g. Formal and precise" className={inputClass} />
          <datalist id="studio-tones">{TONES.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
        <Field label="Audience">
          <input value={draft.audience ?? ''} onChange={(e) => change({ audience: e.target.value })} placeholder="e.g. All staff; IT administrators" className={inputClass} />
        </Field>
      </div>

      <Field label="Language and spelling">
        <select
          value={languageValue}
          onChange={(e) => {
            const other = e.target.value === 'other';
            setOtherLanguage(other);
            if (!other) change({ language: e.target.value }, true);
          }}
          className={inputClass}
        >
          {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          <option value="other">Another language…</option>
        </select>
        {languageValue === 'other' && <input value={LANGUAGES.some((l) => l.value === (draft.language ?? '')) ? '' : (draft.language ?? '')} onChange={(e) => change({ language: e.target.value })} placeholder="Language" className={`${inputClass} mt-2`} />}
      </Field>

      <div>
        <p className="text-xs font-semibold text-[#26323d]">Required items</p>
        <p className="mt-0.5 text-[11px] text-[#586472]">Each must be met. The AI reports on every one after a draft, and the AI check judges them again.</p>
        <ul className="mt-2 space-y-1.5">
          {requirements.map((r, i) => (
            <li key={i} className="flex items-start gap-2 rounded-lg border border-[#d5dbe1] bg-white px-2.5 py-1.5 text-sm text-[#1f2933]">
              <span className="min-w-0 flex-1">{r}</span>
              <button type="button" onClick={() => change({ requirements: requirements.filter((_, k) => k !== i) }, true)} aria-label={`Remove “${r}”`} className="rounded p-0.5 text-[#9b1c1c] hover:bg-[#fdf3f3]"><X className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = newReq.trim(); if (!t) return; change({ requirements: [...requirements, t] }, true); setNewReq(''); }}>
          <input value={newReq} onChange={(e) => setNewReq(e.target.value)} aria-label="A required item" placeholder="e.g. Reviewed every year by the CISO" className={inputClass} />
          <button type="submit" disabled={!newReq.trim()} className="inline-flex items-center gap-1 rounded-lg bg-[#0f766e] px-3 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50"><Plus className="h-4 w-4" /> Add</button>
        </form>
      </div>
    </div>
  );
}
