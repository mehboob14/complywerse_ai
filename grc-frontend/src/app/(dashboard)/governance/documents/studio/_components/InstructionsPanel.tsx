'use client';

/**
 * What the document must respect, whatever is asked in the chat: the organisation's name (used exactly, and checked for),
 * the logo of an exported document and where it sits (top or foot of the page), a watermark, what to focus on, the tone,
 * the audience and the language. Saved as you type.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Star, Trash2, Upload } from 'lucide-react';
import { problemOf, studioApi, type Instructions, type LogoPosition, type Session } from '@/lib/studio/api';
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

const TONES = ['Formal and precise', 'Directive (“shall”, “must”)', 'Plain English', 'Concise', 'Explanatory (guidance)'];
const AUDIENCES = ['All staff', 'Board and senior management', 'Managers and process owners', 'IT and information security teams',
  'Risk, compliance and internal audit', 'Third parties and vendors', 'Regulators and external auditors', 'Customers'];
const WATERMARKS = ['DRAFT', 'CONFIDENTIAL', 'INTERNAL USE ONLY', 'FOR REVIEW', 'UNCONTROLLED COPY'];
const POSITIONS: { value: LogoPosition; label: string }[] = [
  { value: 'header-left', label: 'Top, left' }, { value: 'header-center', label: 'Top, centre' }, { value: 'header-right', label: 'Top, right' },
  { value: 'footer-left', label: 'Bottom, left' }, { value: 'footer-center', label: 'Bottom, centre' }, { value: 'footer-right', label: 'Bottom, right' },
];

const inputClass = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#1f2933] placeholder:text-[#7b8794] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]';
const OTHER = '__other';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-[#26323d]">{label}</span>
      {hint && <span className="mt-0.5 block text-[11px] text-[#586472]">{hint}</span>}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

/** A dropdown of the usual choices, with "Other…" for the person's own words (kept as typed). */
function Choice({ label, value, options, otherLabel, placeholder, onPick }: {
  label: string; value: string; options: string[]; otherLabel: string; placeholder: string;
  /** `now`: save at once (a choice from the list); otherwise the person is typing */
  onPick: (value: string, now: boolean) => void;
}) {
  const [other, setOther] = useState(() => value !== '' && !options.includes(value));
  return (
    <Field label={label}>
      <select value={other ? OTHER : value} aria-label={label}
        onChange={(e) => { if (e.target.value === OTHER) { setOther(true); return; } setOther(false); onPick(e.target.value, true); }} className={inputClass}>
        <option value="">Not set</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={OTHER}>{otherLabel}</option>
      </select>
      {other && <input value={options.includes(value) ? '' : value} onChange={(e) => onPick(e.target.value, false)} placeholder={placeholder} aria-label={`${label}, in your own words`} className={`${inputClass} mt-2`} />}
    </Field>
  );
}

/** Where things land on an exported page: the entity name at the top, the logo where it was put, the watermark across. */
function PagePreview({ position, hasLogo, entity, watermark }: { position: LogoPosition; hasLogo: boolean; entity: string; watermark: string }) {
  const [where, side] = position.split('-') as ['header' | 'footer', 'left' | 'center' | 'right'];
  const justify = side === 'center' ? 'justify-center' : side === 'right' ? 'justify-end' : 'justify-start';
  const logo = hasLogo ? <span className="h-2.5 w-6 rounded-sm bg-[#0f4c5c]/70" aria-hidden /> : null;
  return (
    <div className="relative flex h-[132px] w-[96px] shrink-0 flex-col overflow-hidden rounded-md border border-[#c5ccd3] bg-white px-2 py-1.5 shadow-sm" aria-hidden>
      <div className={`flex items-center gap-1 border-b border-[#e1e5e9] pb-1 ${where === 'header' ? justify : 'justify-start'}`}>
        {where === 'header' && logo}
        <span className="h-1 w-8 rounded bg-[#9aa5b1]" title={entity} />
      </div>
      <div className="mt-1.5 space-y-1">
        {[100, 92, 96, 70, 88, 94, 60].map((w, i) => <span key={i} className="block h-[3px] rounded bg-[#e1e5e9]" style={{ width: `${w}%` }} />)}
      </div>
      {watermark && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-45 whitespace-nowrap text-[11px] font-bold uppercase tracking-wider text-[#0f4c5c]/25">{watermark.slice(0, 14)}</span>
        </span>
      )}
      <div className="mt-auto border-t border-[#e1e5e9] pt-1">
        <span className="block h-[3px] w-10 rounded bg-[#c5ccd3]" />
        {where === 'footer' && logo && <span className={`mt-1 flex ${justify}`}>{logo}</span>}
      </div>
    </div>
  );
}

export default function InstructionsPanel({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const ins = session.instructions;
  const [draft, setDraft] = useState<Instructions>(ins);
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

  const [otherLanguage, setOtherLanguage] = useState(() => !LANGUAGES.some((l) => l.value === (ins.language ?? '')));
  const languageValue = otherLanguage ? 'other' : (draft.language ?? '');
  const position: LogoPosition = POSITIONS.some((p) => p.value === draft.logo_position) ? (draft.logo_position as LogoPosition) : 'header-left';
  const watermarkWords = (draft.watermark_text ?? '').trim() || 'DRAFT';

  return (
    <div className="h-full space-y-4 overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[#1f2933]">Instructions</h3>
          <p className="mt-0.5 text-xs text-[#586472]">Comply Agent follows these in every answer, and the checks verify them.</p>
        </div>
        <span className="text-[11px] text-[#586472]" role="status">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? <span className="inline-flex items-center gap-1 text-[#0a5a38]"><Check className="h-3 w-3" /> Saved</span> : ''}</span>
      </div>

      <Field label="Entity name" hint="Used exactly wherever the organisation is named. The checks warn when it is missing or a placeholder stands in for it.">
        <input value={draft.entity_name ?? ''} onChange={(e) => change({ entity_name: e.target.value })} placeholder="e.g. Capital Financial Services Bank" className={inputClass} />
      </Field>

      <section className="rounded-xl border border-[#d5dbe1] bg-[#f8fafb] p-3" aria-label="Logo and watermark">
        <p className="text-xs font-semibold text-[#26323d]">Logo</p>
        <p className="mt-0.5 text-[11px] text-[#586472]">On every page of an exported Word or PDF document, at the top or at the foot. PNG or JPEG.</p>
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

        <div className="mt-3 flex gap-3">
          <PagePreview position={position} hasLogo={!!draft.logo_asset_id} entity={draft.entity_name ?? ''} watermark={draft.watermark ? watermarkWords : ''} />
          <div className="min-w-0 flex-1 space-y-2.5">
            <label className="block">
              <span className="text-xs font-semibold text-[#26323d]">Position</span>
              <select value={position} onChange={(e) => change({ logo_position: e.target.value as LogoPosition }, true)} className={`${inputClass} mt-1`}>
                <optgroup label="Top of the page (header)">
                  {POSITIONS.filter((p) => p.value.startsWith('header')).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </optgroup>
                <optgroup label="Foot of the page (footer)">
                  {POSITIONS.filter((p) => p.value.startsWith('footer')).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </optgroup>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-[#26323d]">
              <input type="checkbox" checked={!!draft.logo_required} onChange={(e) => change({ logo_required: e.target.checked }, true)} className="accent-[#0f766e]" /> A logo is required
            </label>
            <div>
              <p className="text-xs font-semibold text-[#26323d]" id="studio-watermark">Watermark</p>
              <div className="mt-1 inline-flex rounded-lg border border-[#b8c4c8] bg-white p-0.5" role="radiogroup" aria-labelledby="studio-watermark">
                {([false, true] as const).map((on) => (
                  <button key={String(on)} type="button" role="radio" aria-checked={!!draft.watermark === on} onClick={() => change({ watermark: on }, true)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold ${!!draft.watermark === on ? 'bg-[#0f4c5c] text-white' : 'text-[#3f4b58] hover:bg-[#eef1f4]'}`}>{on ? 'Yes' : 'No'}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {draft.watermark && (
          <div className="mt-2.5">
            <Choice label="Watermark text" value={draft.watermark_text ?? 'DRAFT'} options={WATERMARKS} otherLabel="Your own words…" placeholder="e.g. NOT FOR CIRCULATION"
              onPick={(v, now) => change({ watermark_text: v }, now)} />
            <p className="mt-1 text-[11px] text-[#586472]">Written faintly across every page of an exported Word, PDF or web page, behind the text.</p>
          </div>
        )}
      </section>

      <Field label="Focus areas" hint="Anything Comply Agent should give particular attention to, in your own words.">
        <textarea value={draft.focus_areas ?? ''} onChange={(e) => change({ focus_areas: e.target.value })} rows={3} placeholder="e.g. Remote working, third-party access, evidence the auditors will ask for" className={inputClass} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Choice label="Tone" value={draft.tone ?? ''} options={TONES} otherLabel="Another tone…" placeholder="e.g. Formal but warm" onPick={(v, now) => change({ tone: v }, now)} />
        <Choice label="Audience" value={draft.audience ?? ''} options={AUDIENCES} otherLabel="Another audience…" placeholder="e.g. Branch staff" onPick={(v, now) => change({ audience: v }, now)} />
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
    </div>
  );
}
