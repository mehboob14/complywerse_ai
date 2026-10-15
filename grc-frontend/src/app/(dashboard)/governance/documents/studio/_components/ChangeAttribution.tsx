'use client';

/**
 * Where a change came from, in a few words: who made it and how (accepted from the AI, edited by hand, taken back, a sign-off
 * stamp), in which version and when, the request the person made, and the sources it rests on, each with whether the words the
 * AI quoted were found in the source. Shared by the studio's tracked changes and the document's change chain.
 */
import { AlertTriangle, Bot, CheckCircle2, FileSignature, PencilLine, Undo2 } from 'lucide-react';
import { byLine, type ChainSource, type ChangeBy } from '@/lib/documentChain';
import { ago } from '@/lib/studio/text';

const TONE: Record<string, string> = {
  ai: 'bg-[#e3f1f1] text-[#0f4c5c]',
  manual: 'bg-[#eef1f4] text-[#26323d]',
  revert: 'bg-[#fff2a8] text-[#6b5400]',
  restore: 'bg-[#fff2a8] text-[#6b5400]',
  signoff: 'bg-[#e6f4f1] text-[#0b6b58]',
};

export function OriginBadge({ origin, by, coverage = 1, at, version }: { origin: string; by: string; coverage?: number; at?: string | null; version?: string | null }) {
  const Icon = origin === 'ai' ? Bot : origin === 'revert' || origin === 'restore' ? Undo2 : origin === 'signoff' ? FileSignature : PencilLine;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-[11px] text-[#586472]">
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${TONE[origin] ?? TONE.manual}`}><Icon className="h-3 w-3" aria-hidden /> {byLine(origin, by, coverage)}</span>
      {version && <span className="rounded bg-[#e3f1f1] px-1.5 py-0.5 font-bold text-[#0f4c5c]">v{version}</span>}
      {at && <span>{ago(at)}</span>}
    </span>
  );
}

export function SourceChips({ sources, onShow }: { sources: ChainSource[]; onShow?: (ref: string) => void }) {
  if (!sources?.length) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1" aria-label="Sources this change rests on">
      {sources.map((s, i) => {
        const label = [s.ref, s.title || (s.basis === 'general_knowledge' ? 'General knowledge' : ''), s.locator].filter(Boolean).join(' · ');
        const title = [s.quote ? `“${s.quote}”` : '', s.how || ''].filter(Boolean).join(' — ');
        const body = (
          <>
            {label || 'Source'}
            {s.basis === 'reference' && s.verified === true && <CheckCircle2 className="h-3 w-3 text-[#0a5a38]" aria-label="The quoted words were found in the source" />}
            {s.basis === 'reference' && s.verified === false && <AlertTriangle className="h-3 w-3 text-[#8a6100]" aria-label="The quoted words were not found in the source" />}
          </>
        );
        const cls = 'inline-flex max-w-full items-center gap-1 truncate rounded-md border border-[#d5dbe1] bg-white px-1.5 py-0.5 text-[11px] text-[#3f4b58]';
        return (
          <li key={i} className="min-w-0">
            {onShow && s.ref ? <button type="button" title={title} onClick={() => onShow(s.ref)} className={`${cls} hover:border-[#0f766e]`}>{body}</button> : <span title={title} className={cls}>{body}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Who made a change and why: the badge, the request the person made, the AI's reason and the sources. */
export default function Attribution({ by, onShowSource }: { by: ChangeBy; onShowSource?: (ref: string) => void }) {
  return (
    <div className="min-w-0">
      <OriginBadge origin={by.origin} by={by.by} coverage={by.coverage} at={by.at} version={by.version} />
      {by.request && <p className="mt-1 text-[11px] italic text-[#52606d]">Asked: “{by.request}”</p>}
      {by.reason && <p className="mt-0.5 text-[11px] text-[#3f4b58]">{by.origin === 'ai' ? 'Why: ' : ''}{by.reason}</p>}
      <SourceChips sources={by.sources} onShow={onShowSource} />
    </div>
  );
}
