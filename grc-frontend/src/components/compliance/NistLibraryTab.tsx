'use client';

/**
 * The NIST library behind the AI evidence recommendations: the publications each Cyber
 * Security assessment draws on, their official templates (downloaded from NIST), and the NIST
 * documents in the artifacts catalog, downloadable as Word or PDF. Templates marked for AI
 * drafts are the outlines a drafted document of that kind follows.
 */
import { useMemo, useState } from 'react';
import { BookOpen, ExternalLink, Library, Loader2, Search, Sparkles } from 'lucide-react';
import { ReferenceRow, TemplateLink, useNistLibrary, type Reference } from './AiEvidenceAdvisor';

const ASSESSMENTS = [
  { format: '', label: 'All assessments' },
  { format: 'asvs_checklist', label: 'OWASP ASVS' },
  { format: 'owasp_v4_testing_checklist', label: 'OWASP Testing' },
  { format: 'mobile_app_security', label: 'Mobile App Security' },
  { format: 'csir_maturity', label: 'CSIR Maturity' },
  { format: 'cti_maturity', label: 'CTI Maturity' },
  { format: 'incident_maturity', label: 'Incident Management' },
  { format: 'itsecops_maturity', label: 'IT Security Operations' },
];

export default function NistLibraryTab() {
  const { data, isLoading, isError } = useNistLibrary();
  const [format, setFormat] = useState('');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const publications = useMemo(() => (data?.publications || []).filter((p) =>
    (!format || p.serves.includes(format))
    && (!q || `${p.title} ${p.summary || ''} ${p.templates.map((t) => t.name).join(' ')}`.toLowerCase().includes(q))),
  [data, format, q]);
  const catalog = useMemo(() => {
    const groups = new Map<string, Reference[]>();
    for (const doc of data?.catalog || []) {
      if (q && !`${doc.title} ${doc.type || ''} ${doc.control_ref || ''}`.toLowerCase().includes(q)) continue;
      groups.set(doc.framework, [...(groups.get(doc.framework) || []), doc]);
    }
    return Array.from(groups.entries());
  }, [data, q]);

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (isError || !data) return <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">The NIST library could not be loaded. Try again.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600"><BookOpen className="h-6 w-6 text-white" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-slate-900">NIST library</h2>
          <p className="text-[13px] text-slate-500">
            The NIST publications the AI evidence recommendations draw on, their official templates, and the NIST documents in your artifacts catalog.
            NIST publications are public domain in the US and free to reuse; documents drafted from them credit NIST.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by assessment">
          {ASSESSMENTS.map((a) => (
            <button key={a.format} type="button" onClick={() => setFormat(a.format)} aria-pressed={format === a.format}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition ${format === a.format ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {a.label}
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search publications and documents"
                 aria-label="Search the NIST library"
                 className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-2.5 text-[12.5px] focus:border-violet-400 focus:outline-none" />
        </label>
      </div>

      <section aria-labelledby="nist-publications">
        <h3 id="nist-publications" className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Publications and official templates · {publications.length}
        </h3>
        {publications.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">No publication matches.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {publications.map((p) => (
              <article key={p.id} className="rounded-xl border border-slate-200 bg-white p-3.5">
                <a href={p.url} target="_blank" rel="noreferrer noopener"
                   className="inline-flex items-start gap-1 text-[13px] font-semibold text-slate-900 hover:text-violet-700 hover:underline">
                  {p.title} <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                </a>
                {p.summary && <p className="mt-1 text-[12px] text-slate-600">{p.summary}</p>}
                {p.status && <p className="mt-1 text-[11px] text-amber-700">{p.status}</p>}
                {p.templates.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {p.templates.map((t) => (
                      <div key={t.url} className="flex flex-wrap items-center gap-1.5">
                        <TemplateLink template={t} />
                        {t.drafts_follow && (
                          <span className="inline-flex items-center gap-0.5 text-[10.5px] text-violet-700" title="A drafted document of this kind follows this outline">
                            <Sparkles className="h-3 w-3" /> AI drafts follow it
                          </span>
                        )}
                        {t.note && <span className="text-[10.5px] text-slate-400">{t.note}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="nist-catalog">
        <h3 id="nist-catalog" className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <Library className="h-3.5 w-3.5" /> NIST documents in your artifacts catalog
        </h3>
        {catalog.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">No catalog document matches.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {catalog.map(([framework, docs]) => (
              <div key={framework} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
                <p className="mb-1 text-[12px] font-semibold text-slate-800">{framework} <span className="font-normal text-slate-400">· {docs.length}</span></p>
                <ul className="divide-y divide-slate-100">
                  {docs.map((doc) => <ReferenceRow key={doc.artifact_id} reference={doc} />)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
