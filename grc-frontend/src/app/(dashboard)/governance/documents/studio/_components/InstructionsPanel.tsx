'use client';

/**
 * What the document must respect, whatever is asked in the chat, as dropdown sections that fold to one line: how it was set up (the
 * organisation and its name, used exactly and checked for; where it applies, its regulators, laws, frameworks, subject areas,
 * departments, audience, length, classification and review cycle), the writing style (tone, language, what to focus on), and the
 * exported file (the logo and where it sits, a watermark). Saved as you choose.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Star, Trash2, Upload } from 'lucide-react';
import { problemOf, studioApi, type LogoPosition, type Session } from '@/lib/studio/api';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import AssetImage from './AssetImage';
import { Field, One, SavedState, Section, SetupFields, setupInputClass, useInstructionsDraft } from './SetupFields';

const LANGUAGES = [
  { value: 'en-GB', label: 'English (UK spelling)' },
  { value: 'en-US', label: 'English (US spelling)' },
  { value: 'Arabic', label: 'Arabic', hint: 'Word export only' },
  { value: 'Urdu', label: 'Urdu', hint: 'Word export only' },
  { value: 'French', label: 'French' },
];
const TONES = ['Formal and precise', 'Directive (“shall”, “must”)', 'Plain English', 'Concise', 'Explanatory (guidance)'];
const NO_WATERMARK = 'None';
const WATERMARKS = [NO_WATERMARK, 'DRAFT', 'CONFIDENTIAL', 'INTERNAL USE ONLY', 'FOR REVIEW', 'UNCONTROLLED COPY'];
const POSITIONS: { value: LogoPosition; label: string }[] = [
  { value: 'header-left', label: 'Top, left' }, { value: 'header-center', label: 'Top, centre' }, { value: 'header-right', label: 'Top, right' },
  { value: 'footer-left', label: 'Bottom, left' }, { value: 'footer-center', label: 'Bottom, centre' }, { value: 'footer-right', label: 'Bottom, right' },
];

/** Where things land on an exported page: the entity name at the top, the logo where it was put, the watermark across. */
function PagePreview({ position, hasLogo, entity, watermark }: { position: LogoPosition; hasLogo: boolean; entity: string; watermark: string }) {
  const [where, side] = position.split('-') as ['header' | 'footer', 'left' | 'center' | 'right'];
  const justify = side === 'center' ? 'justify-center' : side === 'right' ? 'justify-end' : 'justify-start';
  const logo = hasLogo ? <span className="h-2 w-5 rounded-sm bg-[#0f4c5c]/70" aria-hidden /> : null;
  return (
    <div className="relative flex h-[100px] w-[72px] shrink-0 flex-col overflow-hidden rounded-md border border-[#c5ccd3] bg-white px-1.5 py-1 shadow-sm" aria-hidden>
      <div className={`flex items-center gap-1 border-b border-[#e1e5e9] pb-1 ${where === 'header' ? justify : 'justify-start'}`}>
        {where === 'header' && logo}
        <span className="h-1 w-6 rounded bg-[#9aa5b1]" title={entity} />
      </div>
      <div className="mt-1 space-y-1">
        {[100, 92, 96, 70, 88, 60].map((w, i) => <span key={i} className="block h-[3px] rounded bg-[#e1e5e9]" style={{ width: `${w}%` }} />)}
      </div>
      {watermark && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-45 whitespace-nowrap text-[9px] font-bold uppercase tracking-wider text-[#000]/25">{watermark.slice(0, 14)}</span>
        </span>
      )}
      <div className="mt-auto border-t border-[#e1e5e9] pt-1">
        <span className="block h-[3px] w-8 rounded bg-[#c5ccd3]" />
        {where === 'footer' && logo && <span className={`mt-1 flex ${justify}`}>{logo}</span>}
      </div>
    </div>
  );
}

export default function InstructionsPanel({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { draft, change, saved } = useInstructionsDraft(session, onChanged);
  const file = useRef<HTMLInputElement>(null);
  const [focus, setFocus] = useState(() => !!String(session.instructions.focus_areas ?? '').trim());

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

  const position: LogoPosition = POSITIONS.some((p) => p.value === draft.logo_position) ? (draft.logo_position as LogoPosition) : 'header-left';
  const watermark = draft.watermark ? ((draft.watermark_text ?? '').trim() || 'DRAFT') : NO_WATERMARK;
  const logoName = assets.data?.items.find((a) => a.id === draft.logo_asset_id)?.name;
  const language = LANGUAGES.find((l) => l.value === draft.language);

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h3 className="text-[15px] font-semibold text-[#1f2933]">Instructions</h3>
          <InfoTip label="About the instructions" text="Comply Agent follows these in every answer, and the checks verify them." />
        </div>
        <SavedState saved={saved} />
      </div>

      <SetupFields session={session} draft={draft} change={change} onReferencesChanged={onChanged} />

      <Section title="Style" summary={[draft.tone, language?.label ?? draft.language, draft.focus_areas && 'focus set'].filter(Boolean).join(' · ')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <One label="Tone" value={String(draft.tone ?? '')} options={TONES.map((t) => ({ value: t, label: t }))} onChange={(v) => change({ tone: v }, true)} />
          <One label="Language" hint="Language and spelling the document is written in, when not set." value={String(draft.language ?? '')} options={LANGUAGES}
            onChange={(v) => change({ language: v }, true)} />
        </div>
        {focus ? (
          <Field label="Focus">
            <textarea value={draft.focus_areas ?? ''} onChange={(e) => change({ focus_areas: e.target.value })} rows={3} autoFocus={!draft.focus_areas}
              placeholder="e.g. Remote working, third-party access, evidence the auditors will ask for" aria-label="What to focus on" className={setupInputClass} />
          </Field>
        ) : (
          <button type="button" onClick={() => setFocus(true)} className="text-xs font-semibold text-[#0f766e] hover:underline" title="What to focus on">+ Focus</button>
        )}
      </Section>

      <Section title="Export" summary={[logoName ? `Logo ${POSITIONS.find((p) => p.value === position)?.label.toLowerCase()}` : 'No logo',
        watermark === NO_WATERMARK ? 'no watermark' : `watermark ${watermark}`].join(' · ')}>
        <Field label="Logo" hint="On every page of an exported Word or PDF document. PNG or JPEG.">
          <div className="flex flex-wrap gap-1.5">
            {assets.data?.items.map((a) => {
              const on = draft.logo_asset_id === a.id;
              return (
                <div key={a.id} className={`group relative flex h-12 w-20 items-center justify-center rounded-lg border bg-[#fff] p-1 ${on ? 'border-[#0f766e] ring-2 ring-[#1ed4b0]' : 'border-[#c5ccd3]'}`}>
                  <button type="button" onClick={() => change({ logo_asset_id: on ? null : a.id }, true)} aria-pressed={on} aria-label={`${on ? 'Stop using' : 'Use'} the logo ${a.name}`} className="absolute inset-0 rounded-lg" />
                  <AssetImage id={a.id} alt={a.name} className="max-h-full max-w-full object-contain" />
                  {on && <span className="absolute right-0.5 top-0.5 rounded-full bg-[#0f766e] p-0.5 text-white"><Check className="h-2.5 w-2.5" /></span>}
                  <span className="absolute inset-x-0 bottom-0 hidden items-center justify-between rounded-b-lg bg-white/95 px-0.5 group-hover:flex group-focus-within:flex">
                    <button type="button" onClick={() => makeDefault.mutate(a.id)} title={a.is_default ? 'The default for new documents' : 'Make the default for new documents'} aria-label={`Make ${a.name} the default`} className="relative z-10 rounded p-0.5 text-[#8a6100] hover:bg-[#fff2a8]"><Star className={`h-3 w-3 ${a.is_default ? 'fill-current' : ''}`} /></button>
                    <button type="button" onClick={() => removeAsset.mutate(a.id)} title="Delete this logo" aria-label={`Delete ${a.name}`} className="relative z-10 rounded p-0.5 text-[#9b1c1c] hover:bg-[#fdf3f3]"><Trash2 className="h-3 w-3" /></button>
                  </span>
                </div>
              );
            })}
            <input ref={file} type="file" hidden accept="image/png,image/jpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
            <button type="button" onClick={() => file.current?.click()} disabled={upload.isPending} className="flex h-12 w-20 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-[#7b8794] bg-white text-[11px] font-medium text-[#3f4b58] hover:border-[#0f766e] hover:bg-[#f3fbf9] disabled:opacity-50">
              {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
            </button>
          </div>
        </Field>
        <div className="flex gap-3">
          <PagePreview position={position} hasLogo={!!draft.logo_asset_id} entity={draft.entity_name ?? ''} watermark={watermark === NO_WATERMARK ? '' : watermark} />
          <div className="min-w-0 flex-1 space-y-2.5">
            <Field label="Position">
              <select value={position} onChange={(e) => change({ logo_position: e.target.value as LogoPosition }, true)} aria-label="Position" className={`${setupInputClass} py-1.5`}>
                <optgroup label="Top (header)">
                  {POSITIONS.filter((p) => p.value.startsWith('header')).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </optgroup>
                <optgroup label="Bottom (footer)">
                  {POSITIONS.filter((p) => p.value.startsWith('footer')).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </optgroup>
              </select>
            </Field>
            <One label="Watermark" hint="Written faintly across every page of an exported file, behind the text." value={watermark}
              options={WATERMARKS.map((w) => ({ value: w, label: w }))}
              onChange={(v) => (!v.trim() || v === NO_WATERMARK ? change({ watermark: false }, true) : change({ watermark: true, watermark_text: v.trim() }, true))} />
            <label className="flex items-center gap-2 text-xs text-[#26323d]">
              <input type="checkbox" role="switch" checked={!!draft.logo_required} onChange={(e) => change({ logo_required: e.target.checked }, true)} className="accent-[#0f766e]" /> Logo required
            </label>
          </div>
        </div>
      </Section>
    </div>
  );
}
