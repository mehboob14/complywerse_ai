'use client';

// A PDF on the public attestation page: its pages one under the other, drawn on the server (so a phone reads them too, where a browser would
// show a PDF in a frame as a link or only its first page). A page loads when it nears the screen; until then it holds its place at the first
// page's shape, so the scroll bar does not jump. The PDF itself opens in a new tab for text selection, search and printing.
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { pageNumbers, pageUrl, pagesNote, withTenant, type PublicDocument } from './_logic';

type Pages = NonNullable<PublicDocument['pages']>;

function Page({ n, count, src, ratio }: { n: number; count: number; src: string; ratio: number }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  return (
    <li className="m-0 list-none">
      <div
        className="relative w-full overflow-hidden border border-ds-border-strong bg-ds-surface"
        style={state === 'ready' ? undefined : { aspectRatio: `1 / ${ratio}` }}
      >
        {state === 'failed' ? (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-[8px] px-[16px] text-center text-ds-body text-ds-fg-muted">
            Page {n} could not be loaded.
            <button
              type="button"
              onClick={() => { setState('loading'); setAttempt((a) => a + 1); }}
              className="min-h-[44px] rounded-ds-control border border-ds-border-control bg-ds-surface px-[16px] text-ds-body text-ds-fg hover:bg-ds-surface-hover focus-visible:shadow-ds-ring focus-visible:outline-none"
            >
              Try again
            </button>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={attempt}
            src={src}
            alt={`Page ${n} of ${count}`}
            loading={n <= 2 ? 'eager' : 'lazy'}
            decoding="async"
            className="block h-auto w-full"
            onLoad={() => setState('ready')}
            onError={() => setState('failed')}
          />
        )}
      </div>
    </li>
  );
}

export default function PdfPages({ pages, fileUrl, base, tenantSlug }: { pages: Pages; fileUrl: string; base: string; tenantSlug: string | null }) {
  const note = pagesNote(pages);
  return (
    <div>
      <div className="mb-[12px] flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[4px] text-ds-label text-ds-fg-muted">
        <span>{pages.total} {pages.total === 1 ? 'page' : 'pages'}</span>
        <a
          href={withTenant(`${base}${fileUrl}`, tenantSlug)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center gap-[6px] rounded-ds-control px-[4px] text-ds-primary-text underline hover:text-ds-primary-hover focus-visible:shadow-ds-ring focus-visible:outline-none sm:min-h-0"
        >
          Open the PDF
          <ExternalLink aria-hidden className="h-[14px] w-[14px]" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      <ol aria-label="Pages of the document" className="m-0 flex list-none flex-col gap-[16px] p-0">
        {pageNumbers(pages.count).map((n) => (
          <Page key={n} n={n} count={pages.count} src={pageUrl(pages.url, n, base, tenantSlug)} ratio={pages.ratio} />
        ))}
      </ol>
      {note && <p className="mt-[12px] text-ds-body text-ds-fg-muted">{note} Open the PDF for the rest.</p>}
    </div>
  );
}
