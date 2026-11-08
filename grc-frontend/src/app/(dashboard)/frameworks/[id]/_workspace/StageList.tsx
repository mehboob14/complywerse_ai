'use client';

// The stages of a framework's authored journey, one row each: its number, name and the clauses it covers, who owns it and how many deliverables and
// artifacts it lists. Open a row for the deliverables and artifacts, each with "Create in Governance" (a draft linked to this framework), and the
// owner. There is NO "Done / In progress / Upcoming" badge: the platform does not track a stage, and the old badge was one percentage spread over
// the stages (stageRows in lib/journeyModel.ts says what is known about a stage).
import { useState } from 'react';
import { Building2, Check, FileText, Paperclip, Plus } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { AccordionRow, Button, StatusPill, useReportedMutation } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { stageRows, type StageRow } from '@/lib/journeyModel';
import type { FrameworkFlow, FrameworkPhase } from '../_data/frameworkFlows';
import StageOwnerPicker, { type StageOwner } from '../_tabs/_StageOwnerPicker';

// Condense the coverage prose to its clause/annex references for the row subtitle.
function shortCoverage(coverage: string): string {
  const refs = coverage.match(/(?:Clauses?|Annex|Art(?:icle)?\.?|Principle|Domain|Step|Function)\s+[A-Za-z0-9.,\-–—/&\s]{0,14}?(?=[;.,(]|\s[a-z]|$)/g);
  if (refs && refs.length) return refs.map((r) => r.trim().replace(/[,\s]+$/, '')).filter(Boolean).slice(0, 3).join(' · ');
  return coverage.length > 60 ? `${coverage.slice(0, 58).trimEnd()}…` : coverage;
}

interface Props {
  flow: FrameworkFlow;
  journeyId: number;
  stageOwners?: Record<string, StageOwner>;
  frameworkId: number | null;
  frameworkName: string;
}

export default function StageList({ flow, journeyId, stageOwners, frameworkId, frameworkName }: Props) {
  const rows = stageRows(flow.phases, stageOwners);
  const byN = new Map<number, FrameworkPhase>(flow.phases.map((p) => [p.n, p]));
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [created, setCreated] = useState<Set<string>>(new Set());
  const label = frameworkName || flow.name;

  // Create a deliverable / artifact as a draft in Governance Documents, linked to this framework as its reference framework.
  const createMut = useReportedMutation({
    mutationFn: (title: string) => governanceApi.createDocument({
      title,
      description: `Drafted from the ${label} compliance journey.`,
      content: `# ${title}\n\n_Drafted from the **${label}** journey. Replace this starter with the actual ${title.toLowerCase()}._\n`,
      doc_type: /procedure/i.test(title) ? 'procedure' : /standard/i.test(title) ? 'standard' : /\bplan\b/i.test(title) ? 'procedure' : 'policy',
      classification: 'internal',
      framework_ids: frameworkId ? [frameworkId] : [],
      applicable_framework_ids: frameworkId ? [frameworkId] : [],
    } as unknown as Record<string, unknown>),
    success: (_d, title) => ({ title: 'Draft created in Governance', message: `“${title}” was added to Governance Documents, linked to ${label}.` }),
    failure: "Couldn't create the draft",
    retryable: false,
    onSuccess: (_d, title) => setCreated((p) => new Set(p).add(title)),
  });
  const onCreate = frameworkId != null ? (title: string) => createMut.mutate(title) : undefined;
  const creating = createMut.isPending ? (createMut.variables ?? null) : null;

  const toggleAll = () => setOpen(open.size === rows.length ? new Set() : new Set(rows.map((r) => r.n)));

  return (
    <div className="space-y-[8px]">
      <div className="flex justify-end">
        <Button size="sm" variant="link" onClick={toggleAll}>{open.size === rows.length ? 'Collapse all' : 'Expand all'}</Button>
      </div>
      <ol className="space-y-[8px]">
        {rows.map((r) => {
          const phase = byN.get(r.n) as FrameworkPhase;
          return (
            <li key={r.n}>
              <AccordionRow
                level={3}
                region={false}
                open={open.has(r.n)}
                onOpenChange={(next) => setOpen((prev) => { const s = new Set(prev); if (next) s.add(r.n); else s.delete(r.n); return s; })}
                lead={<span className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-ds-control bg-ds-border text-ds-body font-[600] text-ds-fg">{r.n}</span>}
                title={r.name}
                meta={<StageMeta row={r} coverage={shortCoverage(r.coverage)} />}
                trailing={<span className="text-ds-label text-ds-fg-muted">{formatCount(r.deliverables)} deliverables · {formatCount(r.artifacts)} artifacts</span>}
              >
                <div className="space-y-[12px]">
                  <p className="text-ds-body text-ds-fg-muted">{r.coverage}</p>
                  <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2">
                    <Items icon={<FileText aria-hidden className="h-[16px] w-[16px]" />} title="Deliverables" items={phase.deliverables} onCreate={onCreate} created={created} creating={creating} />
                    <Items icon={<Paperclip aria-hidden className="h-[16px] w-[16px]" />} title="Evidence & artifacts" items={phase.evidence} onCreate={onCreate} created={created} creating={creating} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[6px] border-t border-ds-border pt-[12px]">
                    <span className="text-ds-label text-ds-fg-muted">Owner</span>
                    <StageOwnerPicker journeyId={journeyId} stageN={r.n} stageName={r.name} suggested={phase.owner} current={stageOwners?.[String(r.n)] ?? null} />
                  </div>
                </div>
              </AccordionRow>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StageMeta({ row, coverage }: { row: StageRow; coverage: string }) {
  return (
    <span className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
      <span>{coverage}</span>
      <StatusPill size="sm" tone={row.external ? 'warning' : 'neutral'} label={row.external ? 'External check' : 'Internal'} />
      <span className="inline-flex items-center gap-[4px]">
        {row.external && <Building2 aria-hidden className="h-[12px] w-[12px]" />}
        {row.owner ? `Owner: ${row.owner}` : 'No owner chosen'}
      </span>
    </span>
  );
}

function Items({
  icon, title, items, onCreate, created, creating,
}: {
  icon: React.ReactNode; title: string; items: string[];
  onCreate?: (title: string) => void; created: Set<string>; creating: string | null;
}) {
  return (
    <div>
      <h4 className="mb-[8px] flex items-center gap-[6px] !text-ds-label !font-[600] !text-ds-fg-muted">{icon}{title}</h4>
      <ul className="space-y-[6px]">
        {(items || []).map((it, idx) => (
          <li key={idx} className="flex flex-wrap items-start gap-x-[8px] gap-y-[2px] text-ds-body text-ds-fg-body">
            <span className="min-w-0 flex-1 basis-[10rem]">{it}</span>
            {onCreate && (
              created.has(it) ? (
                <span className="inline-flex shrink-0 items-center gap-[4px] text-ds-label text-ds-success"><Check aria-hidden className="h-[14px] w-[14px]" /> In Governance</span>
              ) : (
                <Button size="sm" leftIcon={<Plus aria-hidden />} loading={creating === it} onClick={() => onCreate(it)} aria-label={`Create “${it}” as a draft in Governance`}>
                  Create
                </Button>
              )
            )}
          </li>
        ))}
        {(items || []).length === 0 && <li className="text-ds-body text-ds-fg-muted">None listed.</li>}
      </ul>
    </div>
  );
}
