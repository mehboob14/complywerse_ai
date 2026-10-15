'use client';

/**
 * What the assistant is doing while a turn works: the steps it has taken, the answer as it is written, the changes it is preparing and,
 * for a whole document, each part with its words so far. It is a view of the work (the server keeps the finished answer); a server that
 * sends no `live` gets the one line it always was.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Loader2, Pencil } from 'lucide-react';
import type { LiveView, Message } from '@/lib/studio/api';
import { elapsed } from '@/lib/serverTime';

type Part = NonNullable<LiveView['parts']>[number];

/** The text revealed a little at a time, so that what arrives in bursts reads as being written. */
function useTypewriter(target: string): string {
  const [shown, setShown] = useState(target.length);               // a turn found already under way (a reloaded page) shows what exists
  const latest = useRef(target);
  latest.current = target;
  useEffect(() => {
    if (shown > target.length) { setShown(target.length); return; }
    if (shown >= target.length) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(target.length); return; }
    const frame = requestAnimationFrame(() => setShown((n) => Math.min(latest.current.length, n + Math.max(1, Math.ceil((latest.current.length - n) / 40)))));
    return () => cancelAnimationFrame(frame);
  }, [shown, target]);
  return target.slice(0, shown);
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const Caret = () => <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-[#0f766e] align-middle" aria-hidden />;

function PartRow({ part }: { part: Part }) {
  const icon = part.state === 'done' ? <CheckCircle2 className="h-3.5 w-3.5 text-[#0f766e]" />
    : part.state === 'writing' ? <span className="flex h-3.5 w-3.5 items-center justify-center"><span className="h-2 w-2 animate-pulse rounded-full bg-[#0f766e]" /></span>
    : part.state === 'rewriting' ? <Pencil className="h-3.5 w-3.5 animate-pulse text-[#8a6100]" />
    : part.state === 'failed' ? <AlertTriangle className="h-3.5 w-3.5 text-[#8a6100]" />
    : <Circle className="h-3.5 w-3.5 text-[#a3adb8]" />;
  return (
    <li className="py-0.5" data-active={part.state === 'writing' || part.state === 'rewriting' ? 'true' : undefined}>
      <div className="flex items-center gap-2 text-xs">
        <span className="shrink-0" aria-hidden>{icon}</span>
        <span className={`min-w-0 flex-1 truncate ${part.state === 'todo' ? 'text-[#586472]' : 'text-[#1f2933]'}`} title={part.label}>{part.label}</span>
        <span className="shrink-0 tabular-nums text-[#586472]">{part.words > 0 ? `${part.words.toLocaleString()} words` : part.phase ? `${part.phase}…` : ''}</span>
        <span className="sr-only">{part.state}</span>
      </div>
      {part.note && <p className={`ml-[22px] text-[11px] ${part.state === 'rewriting' || part.state === 'failed' ? 'text-[#8a6100]' : 'text-[#586472]'}`}>{part.note}</p>}
    </li>
  );
}

export default function LiveTurn({ message }: { message: Message }) {
  const live = message.live ?? null;
  const now = useNow();
  const typed = useTypewriter(live?.text ?? '');
  const parts = live?.parts ?? [];
  const finished = parts.filter((p) => p.state === 'done' || p.state === 'failed').length;
  const active = live?.steps?.find((s) => s.state === 'active');
  const before = (live?.steps ?? []).filter((s) => s.state === 'done').slice(-5);
  const approach = !!live?.text_label;
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {                                           // keep the parts being written in view as the others finish above them
    const box = list.current;
    const first = box?.querySelector<HTMLElement>('[data-active="true"]');
    if (box && first) box.scrollTop = Math.max(0, first.offsetTop - 4);
  }, [finished]);

  return (
    <div aria-live="off">
      <div className="rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm text-[#3f4b58] ring-1 ring-[#d5dbe1]" aria-busy="true">
        <div className="flex items-center gap-2" role="status">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0f766e]" aria-hidden />
          <span className="min-w-0 flex-1 font-medium text-[#1f2933]">{message.stage || 'Working'}…</span>
          <span className="shrink-0 text-xs tabular-nums text-[#586472]">{elapsed(message.created_at, now)}</span>
        </div>
        {active?.detail && <p className="ml-6 mt-0.5 text-xs text-[#586472]">{active.detail}</p>}

        {before.length > 0 && (
          <ul className="mt-2 space-y-0.5 border-t border-[#eef1f4] pt-2">
            {before.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-[#52606d]">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0f766e]" aria-hidden />
                <span>{s.label}{s.detail && <span className="text-[#586472]"> · {s.detail}</span>}</span>
              </li>
            ))}
          </ul>
        )}

        {approach && typed && (
          <div className="mt-2 border-t border-[#eef1f4] pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#586472]">{live?.text_label}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-[#26323d]">{typed}<Caret /></p>
          </div>
        )}

        {(live?.groups ?? []).map((g) => (
          <div key={g.label} className="mt-2 border-t border-[#eef1f4] pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#586472]">{g.label}</p>
            <ul className="mt-0.5 max-h-36 list-disc space-y-0.5 overflow-y-auto pl-4 text-xs text-[#26323d]">
              {g.items.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </div>
        ))}

        {parts.length > 0 && (
          <div className="mt-2 border-t border-[#eef1f4] pt-2">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#586472]">
              <span>Parts</span>
              <span className="tabular-nums normal-case">{finished} of {parts.length} written</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#e6ebef]" role="progressbar" aria-valuemin={0} aria-valuemax={parts.length} aria-valuenow={finished} aria-label="Parts written">
              <div className="h-full rounded-full bg-[#0f766e] transition-[width] duration-500" style={{ width: `${Math.round((finished / parts.length) * 100)}%` }} />
            </div>
            <ul ref={list} className="relative mt-1.5 max-h-48 overflow-y-auto pr-1">
              {parts.map((p) => <PartRow key={p.id} part={p} />)}
            </ul>
          </div>
        )}

        {live?.tail && (
          <div className="mt-2 border-t border-[#eef1f4] pt-2">
            {live.tail_label && <p className="mb-1 text-[11px] text-[#586472]">{live.tail_label}</p>}
            <div className="relative h-20 overflow-hidden rounded-md bg-[#f1f5f6] ring-1 ring-[#dde3e7]" aria-hidden>
              <div className="absolute inset-x-0 bottom-0 whitespace-pre-wrap break-words px-2 pb-1.5 font-mono text-[11.5px] leading-snug text-[#3f4b58]">{live.tail}<Caret /></div>
              <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-[#f1f5f6] to-transparent" />
            </div>
          </div>
        )}
      </div>

      {!approach && typed && (
        <div className="mt-2 whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white px-3.5 py-2 text-sm leading-relaxed text-[#1f2933] ring-1 ring-[#d5dbe1]">{typed}<Caret /></div>
      )}
    </div>
  );
}
