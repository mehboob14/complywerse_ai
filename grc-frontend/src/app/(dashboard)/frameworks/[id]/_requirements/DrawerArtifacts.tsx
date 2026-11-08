'use client';

// The Artifacts tab of the requirement drawer: the written artifacts the framework recommends for this clause (policies, registers, plans ...), a suggestion for each thing the requirement
// asks for that the catalog does not cover, and what the organisation already made. "Create" and "View" open the Artifacts tab's own forms, so an artifact made here is the same one.
import { FileText, Plus } from 'lucide-react';
import { Button, ErrorState, SkeletonRows, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import type { CatalogItem, TenantArtifact } from '@/components/compliance/ArtifactsTab';
import { artifactSummary } from './artifactModel';
import type { useRequirementArtifacts } from './useRequirementArtifacts';

const FAINT = 'text-ds-label text-ds-fg-muted';

export function DrawerArtifacts({ art, frameworkLabel }: { art: ReturnType<typeof useRequirementArtifacts>; frameworkLabel: string }) {
  if (art.query.isLoading) return <div aria-busy="true"><SkeletonRows rows={4} columns={2} label="Loading the artifacts" /></div>;
  if (art.query.isError) return <ErrorState compact title="Couldn't load the artifacts" message={errorMessage(art.query.error)} onRetry={canRetry(art.query.error) ? () => { void art.query.refetch(); } : undefined} />;
  const madeCount = art.catalog.filter((i) => !!art.madeFor(i)).length;
  return (
    <div className="flex flex-col gap-[16px]">
      <p className="m-0 text-ds-label text-ds-fg-muted">{art.catalog.length > 0 ? artifactSummary(art.catalog.length, madeCount) : `No artifacts are suggested for this requirement${frameworkLabel ? ` in ${frameworkLabel}` : ''}.`}</p>
      {art.catalog.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
          {art.catalog.map((item: CatalogItem) => {
            const made: TenantArtifact | undefined = art.madeFor(item);
            return (
              <li key={item.id} className="flex min-w-0 flex-wrap items-center gap-x-[12px] gap-y-[6px] rounded-ds-card border border-ds-border bg-ds-surface p-[10px]">
                <FileText aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px]">
                    <span className="min-w-0 break-words text-ds-body font-[500] text-ds-fg">{item.name}</span>
                    {item.mandatory && <StatusPill size="sm" tone="warning" label="Mandatory" />}
                    {item.is_platform_native && <StatusPill size="sm" tone="progress" label="Platform" />}
                    {made && <StatusPill size="sm" tone="success" label="Made" />}
                  </div>
                  <p className="m-0 mt-[2px] truncate text-ds-label text-ds-fg-muted">{[item.artifact_type, item.control_ref, item.stage, item.format].filter(Boolean).join(' · ')}</p>
                </div>
                {made ? (
                  <Button size="sm" title="View, edit, download or upload" onClick={() => art.setEditing(made)}>View</Button>
                ) : (
                  <Button size="sm" leftIcon={<Plus aria-hidden />} onClick={() => art.setCreating(item)}>Create</Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {art.handMade.length > 0 && (
        <section aria-label="Other artifacts">
          <h3 className="m-0 mb-[6px] !text-ds-body !font-[600] !text-ds-fg">Other artifacts</h3>
          <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
            {art.handMade.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => art.setEditing(a)}
                  className="flex min-h-ds-control w-full min-w-0 items-center gap-[8px] rounded-ds-control border border-ds-border px-[10px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
                >
                  <FileText aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" />
                  <span className="min-w-0 flex-1 truncate text-ds-body text-ds-fg">{a.name}</span>
                  <span className={FAINT}>{a.artifact_type}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
