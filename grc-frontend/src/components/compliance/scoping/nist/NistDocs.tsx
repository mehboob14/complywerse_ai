'use client';

/**
 * NIST's own documents, on the design-system kit: a publication with its official templates, a written document of the artifacts catalog with its Word and PDF
 * downloads, and (for one assessment) the button that opens what NIST offers it in a panel: the templates of the plans and reports it examines, the
 * publications it follows and the catalog documents of its framework. The NIST library tab lists the same rows for every publication.
 */
import { useState } from 'react';
import { BookOpen, Download, ExternalLink } from 'lucide-react';
import { Button, EmptyState, ErrorState, SkeletonRows, useNotify } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import apiClient from '@/lib/api';
import { formatCount } from '@/lib/format';
import { useNistLibrary, type LibraryPublication, type Reference } from '../../AiEvidenceAdvisor';
import { infoOf } from '../scopingModel';
import { documentsFor } from './nistModel';

const LINK = 'inline-flex items-start gap-[4px] break-words font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring rounded-ds-control';

async function downloadCatalog(doc: Reference, fmt: 'docx' | 'pdf'): Promise<void> {
  const r = await apiClient.get('/artifacts/catalog/export', { params: { artifact_id: doc.artifact_id, framework_key: doc.framework_key, fmt }, responseType: 'blob' });
  const href = URL.createObjectURL(r.data as Blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${doc.title}.${fmt}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** A written document of the artifacts catalog, with its two downloads. */
export function CatalogRow({ doc }: { doc: Reference }) {
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  const get = async (fmt: 'docx' | 'pdf') => {
    setBusy(fmt);
    try { await downloadCatalog(doc, fmt); } catch (e) { notify.error(e, { title: 'The download failed' }); } finally { setBusy(null); }
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[6px] py-[8px]">
      <p className="min-w-0 flex-1 basis-[14rem] break-words text-ds-body text-ds-fg-body">{doc.title}{doc.control_ref && <span className="text-ds-fg-muted">{` · ${doc.control_ref}`}</span>}</p>
      <span className="flex gap-[8px]">
        <Button size="sm" leftIcon={<Download aria-hidden />} loading={busy === 'docx'} onClick={() => void get('docx')}>Word</Button>
        <Button size="sm" leftIcon={<Download aria-hidden />} loading={busy === 'pdf'} onClick={() => void get('pdf')}>PDF</Button>
      </span>
    </li>
  );
}

/** A NIST publication: its link, what it is, and the official templates NIST publishes with it. */
export function Publication({ p }: { p: LibraryPublication }) {
  return (
    <li className="py-[12px]">
      <a href={p.url} target="_blank" rel="noreferrer noopener" className={LINK}>{p.title}<ExternalLink aria-hidden className="mt-[3px] h-[14px] w-[14px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} /></a>
      {p.summary && <p className="mt-[2px] break-words text-ds-body text-ds-fg-body">{p.summary}</p>}
      {p.status && <p className="mt-[2px] text-ds-label text-ds-warning">{p.status}</p>}
      {p.templates.length > 0 && (
        <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
          {p.templates.map((t) => (
            <Button key={t.url} size="sm" href={t.url} target="_blank" rel="noreferrer noopener" leftIcon={<Download aria-hidden />} title={t.note || 'Official NIST template'}>{`${t.name} · ${t.format.toUpperCase()}`}</Button>
          ))}
        </div>
      )}
    </li>
  );
}

/** What NIST offers one assessment, in a panel opened from a button: the templates, the publications and the written documents. */
export function NistDocuments({ format }: { format: string }) {
  const [open, setOpen] = useState(false);
  const lib = useNistLibrary();
  const docs = documentsFor(format, lib.data);
  const templated = docs.publications.filter((p) => p.templates.length > 0);
  const plain = docs.publications.filter((p) => p.templates.length === 0);
  const total = docs.publications.length + docs.catalog.length;
  const heading = 'text-ds-body font-[600] text-ds-fg';

  return (
    <>
      <Button leftIcon={<BookOpen aria-hidden />} onClick={() => setOpen(true)}>{total > 0 ? `NIST documents · ${formatCount(total)}` : 'NIST documents'}</Button>
      <RightSlidePanel isOpen={open} onClose={() => setOpen(false)} width="w-full max-w-2xl" title="NIST documents" subtitle={infoOf(format)?.label}>
        {lib.isLoading ? <SkeletonRows rows={4} columns={2} label="Loading the NIST documents" />
          : lib.isError ? <ErrorState compact title="Couldn't load the NIST documents" message={errorMessage(lib.error)} onRetry={canRetry(lib.error) ? () => { void lib.refetch(); } : undefined} />
          : total === 0 ? <EmptyState kind="firstUse" bare title="Nothing from NIST for this assessment yet" />
          : (
            <div className="space-y-[20px]">
              {templated.length > 0 && (
                <section aria-labelledby="nist-docs-templates">
                  <h3 id="nist-docs-templates" className={heading}>Official templates</h3>
                  <ul className="divide-y divide-ds-border">{templated.map((p) => <Publication key={p.id} p={p} />)}</ul>
                </section>
              )}
              {docs.catalog.length > 0 && (
                <section aria-labelledby="nist-docs-written">
                  <h3 id="nist-docs-written" className={heading}>{`Written documents · ${formatCount(docs.catalog.length)}`}</h3>
                  <ul className="divide-y divide-ds-border">{docs.catalog.map((d) => <CatalogRow key={`${d.framework_key}/${d.artifact_id}`} doc={d} />)}</ul>
                </section>
              )}
              {plain.length > 0 && (
                <section aria-labelledby="nist-docs-publications">
                  <h3 id="nist-docs-publications" className={heading}>Publications</h3>
                  <ul className="divide-y divide-ds-border">{plain.map((p) => <Publication key={p.id} p={p} />)}</ul>
                </section>
              )}
            </div>
          )}
      </RightSlidePanel>
    </>
  );
}
