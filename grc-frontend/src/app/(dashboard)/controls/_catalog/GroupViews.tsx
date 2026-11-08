'use client';

// The two views that open a list inside a list: a domain (its controls grouped by the framework they come from, or by the unified ones) and By framework (one section per framework). A section
// opens in place and only then asks the server for its controls, a page at a time with the true total (the old views asked for the first 500 or 600 and said nothing about the rest).
import { useState } from 'react';
import { ChevronLeft, Layers, SlidersHorizontal } from 'lucide-react';
import { AccordionRow, Button, EmptyState, ErrorState, SkeletonRows } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { KpiTiles } from './HubBand';
import { useDomainGroups } from './catalogData';
import { frameworkQuery, groupQuery, pct, type CatalogOverview, type CatalogRow, type DomainGroup } from './catalogModel';
import { PagedRegister } from './PagedRegister';

const groupKey = (g: DomainGroup): string => `${g.type}-${g.framework_id ?? ''}`;
const controlsWord = (n: number): string => `${formatCount(n)} ${n === 1 ? 'control' : 'controls'}`;

function useOpenKeys() {
  const [open, setOpen] = useState<string[]>([]);
  return {
    isOpen: (k: string) => open.includes(k),
    set: (k: string, on: boolean) => setOpen((cur) => (on ? (cur.includes(k) ? cur : [...cur, k]) : cur.filter((x) => x !== k))),
  };
}

export function DomainDetail({ domain, ov, onBack, onOpenRow }: { domain: string; ov: CatalogOverview | undefined; onBack: () => void; onOpenRow: (r: CatalogRow) => void }) {
  const q = useDomainGroups(domain);
  const keys = useOpenKeys();
  const d = ov?.domains.find((x) => x.domain === domain);
  const src = d?.by_source;
  const sources = src
    ? [src.framework ? `${controlsWord(src.framework)} from ${d?.frameworks} ${d?.frameworks === 1 ? 'framework' : 'frameworks'}` : '', src.internal ? `${formatCount(src.internal)} internal` : '', src.normalized ? `${formatCount(src.normalized)} unified ${src.normalized === 1 ? 'control' : 'controls'}` : ''].filter(Boolean).join(' · ')
    : '';
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-col items-start gap-[8px]">
        <Button variant="link" leftIcon={<ChevronLeft aria-hidden />} onClick={onBack}>All domains</Button>
        <div className="min-w-0">
          <h2 className="m-0 !text-ds-title !text-ds-fg [overflow-wrap:anywhere]">{domain}</h2>
          {d && <p className="m-0 text-ds-label text-ds-fg-muted">{`${sources || controlsWord(d.controls)} · open a control to work it`}</p>}
        </div>
      </div>
      {d && <KpiTiles stats={d} />}
      {q.isError && !q.data ? (
        <ErrorState title="Couldn’t load this domain" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      ) : q.isPending ? (
        <SkeletonRows rows={5} columns={3} label="Loading the domain" />
      ) : (q.data?.groups ?? []).length === 0 ? (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="firstUse" bare icon={Layers} title="Nothing in this domain" description="No framework in your catalog has a control here." />
        </div>
      ) : (
        <div className="divide-y divide-ds-border overflow-clip rounded-ds-card border border-ds-border bg-ds-surface">
          {(q.data?.groups ?? []).map((g) => {
            const k = groupKey(g);
            return (
              <AccordionRow
                key={k}
                title={g.name}
                meta={controlsWord(g.controls)}
                region={false}
                trailing={<span className="text-ds-label tabular-nums text-ds-fg-muted">{g.tested > 0 ? `${pct(g.effective, g.tested)}% of ${formatCount(g.tested)} tested effective` : 'Not tested'}</span>}
                open={keys.isOpen(k)}
                onOpenChange={(on) => keys.set(k, on)}
              >
                {keys.isOpen(k) && (
                  <PagedRegister
                    caption={`Controls in ${domain} from ${g.name}`}
                    scopeKey={['group', domain, g.type, g.framework_id]}
                    buildQuery={(p, s) => groupQuery(domain, g, p, s)}
                    onOpen={onOpenRow}
                    empty={<p className="m-0 p-[12px] text-ds-body text-ds-fg-muted">No controls here.</p>}
                  />
                )}
              </AccordionRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function FrameworkView({ ov, loading, error, onRetry, onOpenRow }: { ov: CatalogOverview | undefined; loading: boolean; error: unknown; onRetry: () => void; onOpenRow: (r: CatalogRow) => void }) {
  const keys = useOpenKeys();
  if (error && !ov) return <ErrorState title="Couldn’t load the frameworks" message={errorMessage(error)} onRetry={canRetry(error) ? onRetry : undefined} />;
  if (loading || !ov) return <SkeletonRows rows={5} columns={3} label="Loading the frameworks" />;
  if (ov.frameworks.length === 0) {
    return (
      <div className="rounded-ds-card border border-ds-border bg-ds-surface">
        <EmptyState
          kind="firstUse" bare icon={SlidersHorizontal} title="No framework in your catalog"
          description="Choose which frameworks the catalog draws its controls from."
          action={<Button variant="primary" href="/controls/configure-frameworks">Configure frameworks</Button>}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[8px]">
      <p className="m-0 text-ds-label text-ds-fg-muted">The same controls, one framework at a time, for teams that work a single framework.</p>
      <div className="divide-y divide-ds-border overflow-clip rounded-ds-card border border-ds-border bg-ds-surface">
      {ov.frameworks.map((f) => {
        const k = `fw-${f.id}`;
        return (
          <AccordionRow key={k} title={f.name} meta={controlsWord(f.controls)} region={false} open={keys.isOpen(k)} onOpenChange={(on) => keys.set(k, on)}>
            {keys.isOpen(k) && (
              <PagedRegister
                caption={`Controls of ${f.name}`}
                scopeKey={['byfw', f.id]}
                buildQuery={(p, s) => frameworkQuery(f.id, p, s)}
                showDomain
                onOpen={onOpenRow}
                empty={<p className="m-0 p-[12px] text-ds-body text-ds-fg-muted">No controls here.</p>}
              />
            )}
          </AccordionRow>
        );
      })}
      </div>
    </div>
  );
}
