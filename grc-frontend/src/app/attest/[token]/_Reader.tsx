'use client';

// The document on the public attestation page, drawn the way it is read: a text document with the document viewer's own renderer, a Word file
// as Word draws it (the file fetched through this link), a PDF page by page, HTML (already cleaned by the server) and plain text as paper.
// Full height, no inner scroll box: a phone scrolls one thing.
import { useEffect, useState } from 'react';
import { Download, FileQuestion, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { GovernanceDocumentMarkdown } from '@/components/governance/GovernanceDocumentMarkdown';
import WordView from '@/components/governance/WordView';
import { Notice, SegmentedControl } from '@/components/ui/ds';
import PdfPages from './_PdfPages';
import { markdownUrl, readKind, withTenant, type PublicDocument } from './_logic';
import styles from './_reading.module.css';

const PAPER = 'rounded-ds-card border border-ds-border bg-ds-surface px-[20px] py-[24px] sm:px-[48px] sm:py-[40px]';
// the renderer sets 14px type on its own elements; reading wants a little more, and a picture must never be wider than the paper
// (styles.ink: the shell's colour overrides repaint every text-gray-* / text-slate-* / text-blue-* class, so a document came out in muted grey and its links in mint 1.9:1)
const MARKDOWN_READING = `${styles.ink} [&_p]:text-[16px] [&_p]:leading-[1.7] [&_li]:text-[16px] [&_li]:leading-[1.7] [&_td]:text-[14px] [&_th]:text-[14px] [&_img]:h-auto [&_img]:max-w-full`;

// below this width an A4 page shrunk to the screen cannot be read: a Word file opens as its text there (Pages is one tap away)
const NARROW = '(max-width: 639px)';
const VIEWS = [{ value: 'page', label: 'Pages' }, { value: 'text', label: 'Text' }] as const;
type WordMode = (typeof VIEWS)[number]['value'];

const LINK = 'inline-flex min-h-[44px] items-center gap-[6px] rounded-ds-control px-[4px] text-ds-primary-text underline hover:text-ds-primary-hover focus-visible:shadow-ds-ring focus-visible:outline-none sm:min-h-[24px]';

function WordReader({ doc, base, tenantSlug }: { doc: PublicDocument; base: string; tenantSlug: string | null }) {
  const url = doc.file?.url || '';
  const textUrl = doc.text_url || '';
  const [mode, setMode] = useState<WordMode>(() => (textUrl && typeof window !== 'undefined' && window.matchMedia?.(NARROW).matches ? 'text' : 'page'));
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [textFailed, setTextFailed] = useState(false);
  const params = tenantSlug ? { tenant_slug: tenantSlug } : undefined;

  // the file is fetched once, when the pages are first shown; the text once, when it is first shown
  useEffect(() => {
    if (mode !== 'page' || blob || failed) return undefined;
    let cancelled = false;
    apiClient
      .get(url, { responseType: 'blob', params })
      .then((res) => { if (!cancelled) setBlob(res.data as Blob); })
      .catch(() => { if (!cancelled) { setFailed(true); if (textUrl) setMode('text'); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, url, tenantSlug]);
  useEffect(() => {
    if (mode !== 'text' || !textUrl || text !== null || textFailed) return undefined;
    let cancelled = false;
    apiClient
      .get(textUrl, { params })
      .then((res) => { if (!cancelled) setText(String((res.data as { markdown?: string }).markdown || '')); })
      .catch(() => { if (!cancelled) setTextFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, textUrl, tenantSlug]);

  return (
    <div>
      <div className="mb-[12px] flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[8px] text-ds-label">
        {textUrl ? <SegmentedControl label="How to read the document" name="word-view" options={VIEWS} value={mode} onChange={setMode} /> : <span />}
        <a href={withTenant(`${base}${url}`, tenantSlug)} download={doc.file_name || undefined} className={LINK}>
          <Download aria-hidden className="h-[14px] w-[14px]" />
          Download the Word file
        </a>
      </div>
      {mode === 'text' ? (
        textFailed ? (
          <Notice tone="danger" title="The text could not be loaded">Reload the page, or download the Word file to read it.</Notice>
        ) : text === null ? (
          <div role="status" aria-label="Loading the text" className="flex justify-center py-[48px]"><Loader2 aria-hidden className="h-[24px] w-[24px] animate-spin text-ds-fg-muted" /></div>
        ) : (
          <article className={PAPER} aria-label={doc.title}>
            <GovernanceDocumentMarkdown content={text} urlTransform={markdownUrl} className={MARKDOWN_READING} />
          </article>
        )
      ) : failed ? (
        <Notice tone="danger" title="The document could not be loaded">Reload the page, or download the Word file to read it.</Notice>
      ) : (
        <div className="overflow-hidden rounded-ds-card border border-ds-border bg-[#e8ecf0]">
          <WordView file={blob} label={doc.title} onFailed={() => { setFailed(true); if (textUrl) setMode('text'); }} />
        </div>
      )}
    </div>
  );
}

export default function Reader({ doc, base, tenantSlug }: { doc: PublicDocument; base: string; tenantSlug: string | null }) {
  switch (readKind(doc)) {
    case 'markdown':
      return (
        <article className={PAPER} aria-label={doc.title}>
          <GovernanceDocumentMarkdown content={doc.markdown || ''} urlTransform={markdownUrl} className={MARKDOWN_READING} />
        </article>
      );
    case 'html':
      return <article className={`${PAPER} ${styles.doc}`} aria-label={doc.title} dangerouslySetInnerHTML={{ __html: doc.html || '' }} />;
    case 'text':
      return (
        <article className={PAPER} aria-label={doc.title}>
          <div className={`${styles.doc} ${styles.plain}`}>{doc.content}</div>
        </article>
      );
    case 'word':
      return <WordReader doc={doc} base={base} tenantSlug={tenantSlug} />;
    case 'pdf':
      return doc.pages && doc.file ? <PdfPages pages={doc.pages} fileUrl={doc.file.url} base={base} tenantSlug={tenantSlug} /> : null;
    default:
      return (
        <div className={`${PAPER} flex flex-col items-center gap-[8px] text-center`}>
          <FileQuestion aria-hidden className="h-[32px] w-[32px] text-ds-fg-muted" />
          <p className="m-0 text-ds-section text-ds-fg">This document can&rsquo;t be shown here</p>
          <p className="m-0 max-w-[48ch] text-ds-body text-ds-fg-muted">
            {doc.file_name ? `${doc.file_name} has no view on this page. ` : ''}Get a copy from your organization and read it, then acknowledge below.
          </p>
        </div>
      );
  }
}
