'use client';

/**
 * Where a question comes from, as a small chip beside its label: "Asked by certification body, auditor", plus a word only when the source is NOT
 * verified ("Secondary source", "Unverified"). Pressing it opens the reference text and the links (each in a new tab); a web address is never printed.
 * It is a native details control, so it opens from the keyboard and a screen reader says it is expandable.
 */
import { ExternalLink, FileText } from 'lucide-react';
import type { Source } from '@/lib/frameworkOnboarding';
import { askedByText, confidenceWord, safeUrls } from './fieldModel';

export default function SourceChip({ source }: { source?: Source | null }) {
  if (!source) return null;
  const who = askedByText(source.asked_by);
  const weak = confidenceWord(source.confidence);
  const reference = (source.ref ?? '').trim();
  const urls = safeUrls(source.urls);
  if (!who && !weak && !reference && urls.length === 0) return null;

  return (
    <details className="min-w-0 max-w-full open:basis-full">
      <summary className="inline-flex max-w-full cursor-pointer list-none items-center gap-[4px] rounded-full border border-ds-border px-[8px] py-[1px] text-ds-label font-normal text-ds-fg-muted hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring [&::-webkit-details-marker]:hidden">
        <FileText aria-hidden className="h-[12px] w-[12px] shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 truncate">{who || 'Source'}</span>
        {weak && <span className="shrink-0 font-medium text-ds-fg">{`· ${weak}`}</span>}
      </summary>
      <div className="mt-[4px] space-y-[6px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[10px]">
        {reference && <p className="break-words text-ds-label font-normal text-ds-fg-body">{reference}</p>}
        {urls.length > 0 && (
          <ul className="flex flex-wrap gap-x-[16px] gap-y-[4px]">
            {urls.map((url, i) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-[4px] rounded-ds-control text-ds-label font-[600] text-ds-primary-text underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-ds-ring">
                  {`Source ${i + 1}`}
                  <ExternalLink aria-hidden className="h-[12px] w-[12px]" strokeWidth={1.75} />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
