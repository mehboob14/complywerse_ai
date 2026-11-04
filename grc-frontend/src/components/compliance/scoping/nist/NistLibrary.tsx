'use client';

/**
 * The NIST library tab of the Cyber Security hub. Two things were here: a list of NIST publications and their official templates, and no way to do any of it. Now it
 * opens with the assessments you can run from the library (SP 800-53A control assessment, CSF 2.0 profile): each follows NIST's own method, lists its artifacts and takes
 * evidence, and starts like every other assessment. The publications, their official templates and the NIST documents of the artifacts catalog stay below as the reference.
 * The tab names the assessment it shows in the address (?assessment=nist_800_53a), so a link, a reload and Back land on it.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Plus, Search } from 'lucide-react';
import { Button, EmptyState, ErrorState, SectionCard, Select, SkeletonRows, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { useNistLibrary, type Reference } from '../../AiEvidenceAdvisor';
import AssessmentTypePage from '../AssessmentTypePage';
import StartDialog from '../StartDialog';
import { isNistFormat, NIST_INFO, TYPE_INFO, typeHref } from '../scopingModel';
import { scopingApi } from '../scopingApi';
import { CatalogRow, Publication } from './NistDocs';

function Library() {
  const [starting, setStarting] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [serves, setServes] = useState('');
  const templates = useQuery({ queryKey: ['scoping-templates'], queryFn: scopingApi.templates });
  const lib = useNistLibrary();
  const q = text.trim().toLowerCase();

  const publications = useMemo(() => (lib.data?.publications ?? []).filter((p) => (!serves || p.serves.includes(serves))
    && (!q || `${p.title} ${p.summary ?? ''} ${p.templates.map((t) => t.name).join(' ')}`.toLowerCase().includes(q))), [lib.data, serves, q]);
  const catalog = useMemo(() => {
    const groups = new Map<string, Reference[]>();
    for (const doc of lib.data?.catalog ?? []) {
      if (q && !`${doc.title} ${doc.type ?? ''} ${doc.control_ref ?? ''}`.toLowerCase().includes(q)) continue;
      groups.set(doc.framework, [...(groups.get(doc.framework) ?? []), doc]);
    }
    return Array.from(groups.entries());
  }, [lib.data, q]);

  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard id="run" title="Assessments you can run" meta={`${Object.keys(NIST_INFO).length} methods`}
        info="Each one follows NIST's own method, lists the artifacts NIST names for what it assesses, and takes evidence uploads and AI evidence recommendations. They start like any other assessment: a draft you scope, then the questions open.">
        {templates.isError ? <ErrorState compact title="Couldn't load the assessments" message={errorMessage(templates.error)} onRetry={canRetry(templates.error) ? () => { void templates.refetch(); } : undefined} /> : (
          <div className="grid gap-[12px] md:grid-cols-2">
            {Object.entries(NIST_INFO).map(([format, info]) => {
              const row = templates.data?.find((t) => t.assessment_format === format);
              const counts = row ? [row.in_progress > 0 && `${row.in_progress} in progress`, row.scoping > 0 && `${row.scoping} ${row.scoping === 1 ? 'draft' : 'drafts'}`].filter(Boolean).join(' · ') : '';
              return (
                <article key={format} className="flex flex-col rounded-ds-card border border-ds-border p-[16px]">
                  <div className="flex flex-wrap items-center gap-x-[8px]">
                    <h3 className="min-w-0 break-words text-ds-section text-ds-fg">{info.label}</h3>
                    {row?.library && !info.label.includes(row.library.version) && <span className="text-ds-label text-ds-fg-muted">{row.library.version}</span>}
                  </div>
                  <p className="mt-[4px] break-words text-ds-body text-ds-fg-body">{info.about}</p>
                  <p className="mt-[8px] text-ds-label text-ds-fg-muted">{info.method}</p>
                  {row?.library?.baselines && <p className="mt-[8px] text-ds-label text-ds-fg-muted">{Object.entries(row.library.baselines).map(([n, b]) => `${n.charAt(0).toUpperCase() + n.slice(1)} ${formatCount(b.controls)}`).join(' · ')} controls</p>}
                  <div className="mt-[12px] flex flex-wrap items-center gap-[8px]">
                    <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setStarting(format)}>Start assessment</Button>
                    <Button href={typeHref(format)} rightIcon={<ArrowRight aria-hidden />}>Open</Button>
                    {counts && <span className="text-ds-body text-ds-fg-muted">{counts}</span>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard id="publications" title="Publications and official templates" meta={lib.data ? `${publications.length} of ${lib.data.publications.length}` : undefined}
        info={lib.data?.note ?? 'The NIST publications the AI evidence recommendations draw on, and the official templates NIST publishes with them.'}
        actions={(
          <>
            <TextInput type="search" aria-label="Search the NIST library" placeholder="Search" value={text} onChange={(e) => setText(e.target.value)} leftAdornment={<Search aria-hidden />} className="w-[14rem]" />
            <Select aria-label="Filter by assessment" value={serves} onChange={(e) => setServes(e.target.value)} className="w-[14rem]">
              <option value="">All assessments</option>
              {[...Object.entries(TYPE_INFO), ...Object.entries(NIST_INFO)].map(([format, info]) => <option key={format} value={format}>{info.label}</option>)}
            </Select>
          </>
        )}>
        {lib.isLoading ? <SkeletonRows rows={4} columns={2} label="Loading the NIST library" />
          : lib.isError || !lib.data ? <ErrorState compact title="Couldn't load the NIST library" message={errorMessage(lib.error)} onRetry={canRetry(lib.error) ? () => { void lib.refetch(); } : undefined} />
          : publications.length === 0 ? <EmptyState kind="noMatches" bare title="No publication matches" onClearFilters={() => { setText(''); setServes(''); }} />
          : <ul className="divide-y divide-ds-border">{publications.map((p) => <Publication key={p.id} p={p} />)}</ul>}
      </SectionCard>

      <SectionCard id="catalog" title="NIST documents in your artifacts catalog" meta={lib.data ? `${catalog.reduce((n, [, docs]) => n + docs.length, 0)} documents` : undefined}
        info="Written NIST documents of the artifacts catalog: they download as Word or PDF, and an assessment's AI recommendations point to them.">
        {lib.isLoading ? <SkeletonRows rows={3} columns={2} label="Loading the catalog" />
          : catalog.length === 0 ? <EmptyState kind="noMatches" bare title="No catalog document matches" />
          : (
            <div className="grid gap-[12px] md:grid-cols-2">
              {catalog.map(([framework, docs]) => (
                <div key={framework} className="rounded-ds-card border border-ds-border px-[12px] py-[8px]">
                  <p className="text-ds-body font-[600] text-ds-fg">{framework}<span className="font-normal text-ds-fg-muted">{` · ${docs.length}`}</span></p>
                  <ul className="divide-y divide-ds-border">{docs.map((d) => <CatalogRow key={`${d.framework_key}/${d.artifact_id}`} doc={d} />)}</ul>
                </div>
              ))}
            </div>
          )}
      </SectionCard>
      {starting && <StartDialog format={starting} onClose={() => setStarting(null)} />}
    </div>
  );
}

/** The tab: the library, or (named in the address) one NIST assessment type with a way back. */
export default function NistLibrary() {
  const named = useSearchParams()?.get('assessment') ?? '';
  if (named && isNistFormat(named)) {
    return (
      <div className="flex flex-col gap-[16px]">
        <div><Button size="sm" href="/cyber-security?tab=nist_library" leftIcon={<ArrowLeft aria-hidden />}>NIST library</Button></div>
        <AssessmentTypePage format={named} />
      </div>
    );
  }
  return <Library />;
}
