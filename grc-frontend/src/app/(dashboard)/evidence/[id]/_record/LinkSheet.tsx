'use client';

// "Link records": ONE sheet with the kinds of record as tabs, in place of five modals that never opened, a type-picker popup and three unbounded loads on every open. A kind's list is read
// when its tab is first opened (one request, with its own loading, empty and failed states and a Retry), minus what is already linked; the first 100 matches of a search are drawn
// ("Showing 100 of 412"). Pressing a row links it at once, as it always did, and the sheet stays open for the next one; the row leaves the list when the link is made. A policy statement is
// found in two steps (the document, then its statements, several at a time). A link that fails is said by the page's mutation; nothing here assumes it worked.
import { useMemo, useState } from 'react';
import { ArrowLeft, Check, Loader2, Search } from 'lucide-react';
import { Button, Checkbox, ErrorState, Sheet, SkeletonRows, TabPanel, Tabs, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { LINKABLE, LINK_LABEL, auditObservationId, matchItems, type LinkType, type PickItem } from './linkModel';
import { useAuditOptions, useCommonControls, useDocuments, useIncidents, useRisks, useAssets, useStatements } from './recordData';
import type { LinkRequest } from './recordActions';
import type { AllLinks, ControlsResponse } from './recordTypes';

const MUTED = 'text-ds-fg-muted';
type Kind = (typeof LINKABLE)[number];
const ROW = 'flex min-h-ds-control w-full items-center gap-[8px] rounded-ds-control px-[8px] py-[6px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] disabled:cursor-wait';

interface Source { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

/** A searchable list of records to link, with the states of its request. */
function PickPanel({ source, items, searchLabel, empty, busy, onPick }: {
  source: Source;
  items: readonly PickItem[];
  searchLabel: string;
  empty: string;
  /** the value being linked right now */
  busy: string | null;
  onPick: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const { shown, total } = useMemo(() => matchItems(items, query), [items, query]);
  if (source.isPending) return <SkeletonRows rows={6} columns={2} label="Loading the list" />;
  if (source.isError) return <ErrorState compact title="Couldn't load the list" message={errorMessage(source.error)} onRetry={canRetry(source.error) ? () => { void source.refetch(); } : undefined} />;
  if (items.length === 0) return <p role="status" className={`text-ds-body ${MUTED}`}>{empty}</p>;
  return (
    <div className="flex flex-col gap-[12px]">
      <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label={searchLabel} placeholder={searchLabel} autoComplete="off" leftAdornment={<Search aria-hidden />} />
      <p role="status" className={`text-ds-label ${MUTED}`}>
        {total === 0 ? 'Nothing matches.' : total > shown.length ? `Showing ${formatCount(shown.length)} of ${formatCount(total)}. Search to narrow it down.` : `${formatCount(total)} ${total === 1 ? 'match' : 'matches'}`}
      </p>
      <ul className="m-0 list-none p-0">
        {shown.map((i) => (
          <li key={i.value} className="border-b border-ds-border last:border-b-0">
            <button type="button" disabled={busy != null} onClick={() => onPick(i.value)} className={ROW}>
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{i.label}</span>
                {i.sub && <span className={`block break-words text-ds-label ${MUTED}`}>{i.sub}</span>}
              </span>
              <span className="shrink-0 text-ds-label font-[600] text-ds-primary-text">
                {busy === i.value ? <Loader2 aria-hidden className="h-[16px] w-[16px] animate-spin motion-reduce:animate-none" /> : <span className="inline-flex items-center gap-[2px]"><Check aria-hidden className="h-[14px] w-[14px]" />Link</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A policy statement is found through its document: pick the document, then tick the statements. */
function PolicyPanel({ linked, busy, onLink }: { linked: ReadonlySet<number>; busy: boolean; onLink: (ids: number[], done: () => void) => void }) {
  const documents = useDocuments(true);
  const [doc, setDoc] = useState<{ id: number; title: string } | null>(null);
  const [query, setQuery] = useState('');
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const statements = useStatements(doc?.id ?? null);
  const docItems: PickItem[] = useMemo(() => (documents.data ?? []).map((d) => ({ value: String(d.id), label: d.title || 'A document', sub: [d.document_code, d.doc_type].filter(Boolean).join(' · ') || undefined })), [documents.data]);
  const list = statements.data?.statements ?? [];
  const rows = useMemo(() => matchItems(list.map((s) => ({ value: String(s.id), label: s.statement_summary || s.statement_text || 'A policy statement', sub: s.statement_code ?? undefined })), query), [list, query]);

  if (!doc) {
    return (
      <PickPanel
        source={documents} items={docItems} searchLabel="Search documents by title, code or type" empty="No governance documents were found." busy={null}
        onPick={(v) => { setDoc({ id: Number(v), title: docItems.find((d) => d.value === v)?.label ?? 'Document' }); setQuery(''); setTicked(new Set()); }}
      />
    );
  }
  const toggle = (id: number) => setTicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <Button size="sm" leftIcon={<ArrowLeft aria-hidden />} onClick={() => setDoc(null)}>Documents</Button>
        <span dir="auto" className="min-w-0 break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{doc.title}</span>
      </div>
      {statements.isPending ? <SkeletonRows rows={5} columns={2} label="Loading the statements" /> : statements.isError ? (
        <ErrorState compact title="Couldn't load the statements" message={errorMessage(statements.error)} onRetry={canRetry(statements.error) ? () => { void statements.refetch(); } : undefined} />
      ) : statements.data?.refused ? (
        <p role="status" className={`text-ds-body ${MUTED}`}>You may not open this document’s statements. Its owner or a governance administrator can give you access.</p>
      ) : list.length === 0 ? (
        <p role="status" className={`text-ds-body ${MUTED}`}>This document has no parsed policy statements yet. Run the policy parser on the document first.</p>
      ) : (
        <>
          <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search statements by code or text" placeholder="Search statements by code or text" autoComplete="off" leftAdornment={<Search aria-hidden />} />
          <p role="status" className={`text-ds-label ${MUTED}`}>{rows.total === 0 ? 'Nothing matches.' : rows.total > rows.shown.length ? `Showing ${formatCount(rows.shown.length)} of ${formatCount(rows.total)}. Search to narrow it down.` : `${formatCount(rows.total)} ${rows.total === 1 ? 'statement' : 'statements'}`}</p>
          <ul className="m-0 list-none p-0">
            {rows.shown.map((s) => {
              const id = Number(s.value);
              const already = linked.has(id);
              return (
                <li key={s.value} className="border-b border-ds-border last:border-b-0">
                  <Checkbox
                    checked={already || ticked.has(id)} disabled={already} onChange={() => toggle(id)} className="w-full"
                    label={<span className="block"><span className={`block text-ds-label font-[600] text-ds-primary-text`}>{s.sub ?? 'Statement'}{already ? ' · already linked' : ''}</span><span className="block break-words text-ds-body text-ds-fg-body">{s.label}</span></span>}
                  />
                </li>
              );
            })}
          </ul>
          <div>
            <Button variant="primary" loading={busy} disabled={ticked.size === 0} onClick={() => onLink(Array.from(ticked), () => setTicked(new Set()))}>
              {ticked.size > 0 ? `Link ${formatCount(ticked.size)} ${ticked.size === 1 ? 'statement' : 'statements'}` : 'Link statements'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function LinkSheet({ open, onClose, evidenceId, name, start, controls, links, busy, onLink }: {
  open: boolean;
  onClose: () => void;
  evidenceId: number;
  name: string;
  /** the kind whose tab opens first */
  start: LinkType | null;
  controls: ControlsResponse | undefined;
  links: AllLinks | undefined;
  busy: boolean;
  onLink: (req: LinkRequest, done?: () => void) => void;
}) {
  const first: Kind = (LINKABLE as readonly string[]).includes(start ?? '') ? (start as Kind) : 'common_controls';
  const [tab, setTab] = useState<Kind>(first);
  const [pending, setPending] = useState<string | null>(null);
  // the sheet opens on the kind the person was looking at
  const [seen, setSeen] = useState<string | null>(null);
  if (open && seen !== `${first}`) { setSeen(`${first}`); setTab(first); }
  if (!open && seen !== null) setSeen(null);

  const commonQ = useCommonControls(open && tab === 'common_controls');
  const risksQ = useRisks(open && tab === 'risks');
  const assetsQ = useAssets(open && tab === 'assets');
  const incidentsQ = useIncidents(open && tab === 'incidents');
  const auditQ = useAuditOptions(evidenceId, open && tab === 'audit_observations');

  const commonItems: PickItem[] = useMemo(() => {
    const have = new Set((controls?.normalized_controls ?? []).map((m) => m.normalized_control?.scf_id));
    return (commonQ.data ?? []).filter((c) => !have.has(c.scf_id)).map((c) => ({ value: c.scf_id, label: `${c.scf_id} — ${c.name}` }));
  }, [commonQ.data, controls]);
  const riskItems: PickItem[] = useMemo(() => {
    const have = new Set((links?.risks?.links ?? []).map((l) => l.risk_id));
    return (risksQ.data ?? []).filter((r) => !have.has(r.id)).map((r) => ({ value: String(r.id), label: r.title || 'A risk' }));
  }, [risksQ.data, links]);
  const assetItems: PickItem[] = useMemo(() => {
    const have = new Set((links?.assets?.links ?? []).map((l) => l.asset_id));
    return (assetsQ.data ?? []).filter((a) => !have.has(a.id)).map((a) => ({ value: String(a.id), label: a.name || 'An asset', sub: a.asset_type ? String(a.asset_type) : undefined }));
  }, [assetsQ.data, links]);
  const incidentItems: PickItem[] = useMemo(() => {
    const have = new Set((links?.incidents?.links ?? []).map((l) => l.incident_id));
    return (incidentsQ.data ?? []).filter((i) => !have.has(i.id)).map((i) => ({ value: String(i.id), label: i.title || 'An incident', sub: i.severity ?? undefined }));
  }, [incidentsQ.data, links]);
  const auditItems: PickItem[] = useMemo(() => {
    const have = new Set((links?.audit_observations?.links ?? []).map((l) => auditObservationId(l.kind, l.record_id)));
    return (auditQ.data ?? []).filter((o) => !have.has(auditObservationId(o.kind, o.record_id))).map((o) => ({ value: `${o.kind}:${o.record_id}`, label: `${o.code ? `${o.code} — ` : ''}${o.title || 'Untitled'}`, sub: o.subtitle ?? undefined }));
  }, [auditQ.data, links]);
  const policyLinked = useMemo(() => new Set((links?.policy_statements?.links ?? []).map((l) => l.policy_statement_id)), [links]);

  const link = (req: LinkRequest, value: string) => {
    setPending(value);
    onLink(req, () => setPending(null));
  };
  // a failed link leaves the row pressable again
  const idle = busy ? pending : null;

  return (
    <Sheet open={open} onClose={() => { setPending(null); onClose(); }} title="Link records" subtitle={name} width="md" initialFocus="input[type=search]"
      footer={<div className="flex justify-end"><Button variant="primary" onClick={onClose}>Done</Button></div>}>
      <Tabs
        ariaLabel="Kinds of record to link"
        value={tab}
        onChange={(k) => { setTab(k as Kind); setPending(null); }}
        tabs={LINKABLE.map((k) => ({ key: k, label: LINK_LABEL[k] }))}
      >
        <div className="pt-[16px]">
          <TabPanel tabKey="common_controls" lazy>
            <PickPanel source={commonQ} items={commonItems} searchLabel="Search common controls" empty="Every common control is already linked." busy={idle} onPick={(v) => link({ kind: 'common_controls', recs: [{ scfId: v }] }, v)} />
          </TabPanel>
          <TabPanel tabKey="policy_statements" lazy>
            <PolicyPanel linked={policyLinked} busy={busy} onLink={(ids, done) => onLink({ kind: 'policy_statements', ids }, done)} />
          </TabPanel>
          <TabPanel tabKey="audit_observations" lazy>
            <PickPanel
              source={auditQ} items={auditItems} searchLabel="Search audit observations" empty="Every audit observation is already linked." busy={idle}
              onPick={(v) => { const [kind, id] = v.split(':'); link({ kind: 'audit_observations', recs: [{ auditKind: kind, recordId: Number(id) }] }, v); }}
            />
          </TabPanel>
          <TabPanel tabKey="risks" lazy>
            <PickPanel source={risksQ} items={riskItems} searchLabel="Search risks" empty="Every risk is already linked." busy={idle} onPick={(v) => link({ kind: 'risks', ids: [Number(v)] }, v)} />
          </TabPanel>
          <TabPanel tabKey="assets" lazy>
            <PickPanel source={assetsQ} items={assetItems} searchLabel="Search assets" empty="Every asset is already linked." busy={idle} onPick={(v) => link({ kind: 'assets', ids: [Number(v)] }, v)} />
          </TabPanel>
          <TabPanel tabKey="incidents" lazy>
            <PickPanel source={incidentsQ} items={incidentItems} searchLabel="Search incidents" empty="Every incident is already linked." busy={idle} onPick={(v) => link({ kind: 'incidents', ids: [Number(v)] }, v)} />
          </TabPanel>
        </div>
      </Tabs>
    </Sheet>
  );
}
