'use client';

// The small pieces the sheets of Connected systems share: a logo, a title with a logo, a health pill, a copy button that says whether it copied, and the key-file field. None of them
// ever shows a credential: a secret is typed into a masked box and goes away with the sheet.
import { useRef, useState, type ReactNode } from 'react';
import { Check, Copy, FileKey } from 'lucide-react';
import { Button, StatusPill, Textarea } from '@/components/ui/ds';
import { BrandLogo } from '@/components/integrations/BrandLogo';
import { statusPill } from '@/lib/status';
import { connectionHealth } from '@/lib/statuses/connections';
import { logoOf, type Health } from './connectedModel';

export function Logo({ provider, name, size = 32 }: { provider: string; name: string; size?: number }) {
  return <BrandLogo id={logoOf(provider)} name={name} size={size} />;
}

export function HealthPill({ health }: { health: Health }) {
  return <StatusPill size="sm" {...statusPill(connectionHealth, health)} />;
}

/** The title of a sheet: the mark, then the name (cut with an ellipsis, never wrapped over the close button). */
export function SheetTitle({ provider, name }: { provider: string; name: string }) {
  return <span className="inline-flex min-w-0 items-center gap-[10px]"><Logo provider={provider} name={name} /><span className="min-w-0 truncate" title={name}>{name}</span></span>;
}

/** A value to copy into another console: the copy says "Copied", or says it could not (the browser may refuse) so the person knows to select it by hand. */
export function CopyBlock({ label, value, help }: { label: string; value: string; help?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'refused'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = async () => {
    let next: 'copied' | 'refused' = 'copied';
    try { await navigator.clipboard.writeText(value); } catch { next = 'refused'; }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 3000);
  };
  return (
    <div className="rounded-ds-card border border-ds-border bg-ds-surface">
      <div className="flex flex-wrap items-center justify-between gap-[8px] border-b border-ds-border px-[10px] py-[4px]">
        <span className="min-w-0 text-ds-label font-[600] text-ds-fg-muted">{label}</span>
        <span className="inline-flex items-center gap-[8px]">
          <span role="status" className="text-ds-label text-ds-fg-muted">{state === 'copied' ? 'Copied' : state === 'refused' ? 'Could not copy: select the text and copy it' : ''}</span>
          <Button size="sm" variant="link" leftIcon={state === 'copied' ? <Check aria-hidden /> : <Copy aria-hidden />} onClick={copy} aria-label={`Copy ${label}`}>Copy</Button>
        </span>
      </div>
      <pre className="m-0 max-h-[160px] overflow-y-auto whitespace-pre-wrap break-all px-[10px] py-[6px] font-mono text-ds-label text-ds-fg">{value}</pre>
      {help && <p className="m-0 px-[10px] pb-[6px] text-ds-label text-ds-fg-muted">{help}</p>}
    </div>
  );
}

/** A key file for a service account: chosen from disk (its content is read into memory and never shown) or pasted into a masked box. `value` is only ever read by the form's submit. */
export function KeyFileField({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [unreadable, setUnreadable] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUnreadable(false);
    try { onChange(await file.text()); setFileName(file.name); } catch { setUnreadable(true); }
  };
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <input ref={input} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        <Button leftIcon={<FileKey aria-hidden />} disabled={disabled} onClick={() => input.current?.click()}>Choose key file</Button>
        {value.trim() && <span role="status" className="text-ds-label text-ds-fg-muted">{fileName ? `Key file ready (${fileName})` : 'Key ready'}</span>}
        {value.trim() && <Button variant="link" size="sm" disabled={disabled} onClick={() => { onChange(''); setFileName(''); }}>Clear</Button>}
      </div>
      {unreadable && <p role="alert" className="m-0 text-ds-label text-ds-danger">That file could not be read. Try another, or paste its contents below.</p>}
      <Textarea
        aria-label="Or paste the key file contents" rows={3} value={fileName ? '' : value} disabled={disabled || Boolean(fileName)} autoComplete="off" spellCheck={false}
        placeholder={fileName ? 'The key file chosen above is used' : 'Or paste the contents of the key file'} onChange={(e) => onChange(e.target.value)}
        className="font-mono [-webkit-text-security:disc]"
      />
    </div>
  );
}

/** A labelled block of the guide: a short heading and what is under it. */
export function GuideBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
      <h3 className="m-0 mb-[6px] !text-ds-body !font-[600] !text-ds-fg">{title}</h3>
      {children}
    </section>
  );
}
