'use client';

/**
 * Where a change came from, in a few words: who made it and how (accepted from the AI, edited by hand, taken back, a sign-off
 * stamp), in which version and when, the request the person made, and the sources it rests on, each with whether the words the
 * AI quoted were found in the source. Shared by the studio's tracked changes and the document's change chain.
 *
 * Colours follow the design system and stay readable inside the platform shell (which repaints slate classes): the AI is
 * teal, an edit by hand is neutral, taking back and restoring are amber, a sign-off is emerald, the original is outlined.
 */
import { AlertTriangle, CheckCircle2, FileSignature, FileUp, Flag, GitCommitVertical, History, ListChecks, Minus, PencilLine, Sparkles, Undo2, type LucideIcon } from 'lucide-react';
import { byLine, sourceLabel, type ChainSource, type ChangeBy } from '@/lib/documentChain';
import { ago } from '@/lib/studio/text';

export interface OriginLook {
  icon: LucideIcon;
  /** a pill: background, text and ring */
  pill: string;
  /** a round marker on a timeline */
  node: string;
}

export const ORIGIN_LOOK: Record<string, OriginLook> = {
  ai: { icon: Sparkles, pill: 'bg-primary-50 text-[#0b6b58] ring-primary-100', node: 'bg-primary-50 text-[#0b6b58] ring-primary-100' },
  mixed: { icon: Sparkles, pill: 'bg-primary-50 text-[#0b6b58] ring-primary-100', node: 'bg-primary-50 text-[#0b6b58] ring-primary-100' },
  manual: { icon: PencilLine, pill: 'bg-[#f1f5f9] text-[#334155] ring-[#e2e8f0]', node: 'bg-[#f1f5f9] text-[#475569] ring-[#e2e8f0]' },
  // statements edited by a person and written into the document: neutral like an edit by hand, told apart by its icon
  statement: { icon: ListChecks, pill: 'bg-[#f1f5f9] text-[#334155] ring-[#e2e8f0]', node: 'bg-[#f1f5f9] text-[#475569] ring-[#e2e8f0]' },
  revert: { icon: Undo2, pill: 'bg-amber-50 text-amber-800 ring-amber-200', node: 'bg-amber-50 text-amber-700 ring-amber-200' },
  restore: { icon: History, pill: 'bg-amber-50 text-amber-800 ring-amber-200', node: 'bg-amber-50 text-amber-700 ring-amber-200' },
  signoff: { icon: FileSignature, pill: 'bg-emerald-50 text-emerald-800 ring-emerald-200', node: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  initial: { icon: Flag, pill: 'bg-[#ffffff] text-[#0f4c5c] ring-[#94a3b8]', node: 'bg-[#ffffff] text-[#0f4c5c] ring-[#94a3b8]' },
  file: { icon: FileUp, pill: 'bg-[#f1f5f9] text-[#334155] ring-[#e2e8f0]', node: 'bg-[#f1f5f9] text-[#475569] ring-[#e2e8f0]' },
  import: { icon: FileUp, pill: 'bg-[#f1f5f9] text-[#334155] ring-[#e2e8f0]', node: 'bg-[#f1f5f9] text-[#475569] ring-[#e2e8f0]' },
  nochange: { icon: Minus, pill: 'bg-[#f8fafc] text-[#586472] ring-[#e2e8f0]', node: 'bg-[#f8fafc] text-[#94a3b8] ring-[#e2e8f0]' },
  unknown: { icon: GitCommitVertical, pill: 'bg-[#f1f5f9] text-[#334155] ring-[#e2e8f0]', node: 'bg-[#f1f5f9] text-[#475569] ring-[#e2e8f0]' },
};

export const originLook = (origin: string): OriginLook => ORIGIN_LOOK[origin] ?? ORIGIN_LOOK.unknown;

export function OriginBadge({ origin, by, coverage = 1, at, version }: { origin: string; by: string; coverage?: number; at?: string | null; version?: string | null }) {
  const look = originLook(origin);
  const Icon = look.icon;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-[#586472]">
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${look.pill}`}><Icon className="h-3 w-3" strokeWidth={2} aria-hidden /> {byLine(origin, by, coverage)}</span>
      {version && <span className="rounded-md bg-[#f1f5f9] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#334155]">v{version}</span>}
      {at && <span>{ago(at)}</span>}
    </span>
  );
}

export function SourceChips({ sources, onShow }: { sources: ChainSource[]; onShow?: (ref: string) => void }) {
  if (!sources?.length) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Sources this change rests on">
      {sources.map((s, i) => {
        const label = sourceLabel(s);
        const title = [s.quote ? `“${s.quote}”` : '', s.how || ''].filter(Boolean).join(' — ');
        const body = (
          <>
            {label}
            {s.basis === 'reference' && s.verified === true && <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" aria-label="The quoted words were found in the source" />}
            {s.basis === 'reference' && s.verified === false && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" aria-label="The quoted words were not found in the source" />}
          </>
        );
        const cls = 'inline-flex max-w-full items-center gap-1 truncate rounded-md border border-[#e2e8f0] bg-[#ffffff] px-1.5 py-0.5 text-[11px] text-[#334155]';
        return (
          <li key={i} className="min-w-0">
            {onShow && s.ref ? <button type="button" title={title} onClick={() => onShow(s.ref)} className={`${cls} hover:border-primary-600`}>{body}</button> : <span title={title} className={cls}>{body}</span>}
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
      {by.request && <p className="mt-1.5 border-l-2 border-primary-100 pl-2 text-[12px] italic text-[#475569]">“{by.request}”</p>}
      {by.reason && <p className="mt-1 text-[12px] text-[#334155]">{by.origin === 'ai' ? <span className="font-medium text-[#0b6b58]">Why: </span> : null}{by.reason}</p>}
      <SourceChips sources={by.sources} onShow={onShowSource} />
    </div>
  );
}
