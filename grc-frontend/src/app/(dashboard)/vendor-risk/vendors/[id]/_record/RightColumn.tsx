'use client';

// The 20rem column beside every tab but the Lifecycle: who owns the vendor, its dates, its contacts, what it may duplicate, and how far
// the engagement the page picked has come. Facts, not prose (the D41 charter): a label in small grey over the value.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Star } from 'lucide-react';
import { Panel, PersonChip, TONE, fmt } from '../../../_ui';
import { tpraApi } from '@/lib/api';
import type { EngagementList } from '../../../_lib/engagementsApi';
import { matchHref, matchNote } from '../../../_lib/intakeModel';
import { portalApi, type SupplierContact } from '../../../_lib/portalApi';
import { TPRM_QUERY_OPTS } from '../../../_lib/tprmQuery';
import { useDuplicates } from '../../../_lib/vendorRecordApi';
import { contactLine, daysUntil, isTiered, nextReview, openScopes, recordHref, settled, sourceLabel } from '../../../_lib/vendorRecordModel';
import type { LifecycleResponse } from '../_tpra/types';

const ICON_BTN = 'grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] leading-4 text-[#64707e]">{label}</dt>
      <dd className="mt-0.5 text-[13px] leading-5 text-[#26323d]">{children}</dd>
    </div>
  );
}

export default function RightColumn({ vendorId, vendor, engagementId, engagements, canEdit, onAddContact, onEditContact }: {
  vendorId: number;
  vendor: Record<string, any>;
  /** the engagement the page picked; null is General */
  engagementId: number | null;
  engagements: EngagementList | undefined;
  canEdit: boolean;
  onAddContact: () => void;
  onEditContact: (contact: SupplierContact) => void;
}) {
  const contacts = useQuery({
    queryKey: ['tprm-contacts', vendorId, false],
    queryFn: async () => (await portalApi.contacts(vendorId, false)).data.items,
    ...TPRM_QUERY_OPTS,
  });
  const duplicates = useDuplicates(String(vendor.name ?? ''), String(vendor.website ?? ''), vendorId).data ?? [];

  // The same read the Lifecycle tab makes (and the same key), so the two share one answer.
  const life = useQuery({
    queryKey: ['tpra-lifecycle', vendorId, engagementId],
    queryFn: async () => (await tpraApi.getLifecycle(vendorId, engagementId)).data as LifecycleResponse,
    ...TPRM_QUERY_OPTS,
  });

  const items = engagements?.items;
  const row = openScopes(items).find((e) => (engagementId ? e.id === engagementId : e.is_general)) ?? null;
  const next = nextReview(items, vendor.next_reassessment_date);
  const days = daysUntil(next);
  const progress = settled(life.data?.stages);
  const listed = (contacts.data ?? []).filter((c) => !c.archived_at);

  return (
    <aside aria-label="About this vendor" className="space-y-5">
      <Panel title="Ownership">
        <dl className="space-y-3">
          <Row label="Business owner"><PersonChip name={vendor.owner?.full_name} /></Row>
          <Row label="Security owner"><PersonChip name={vendor.security_owner?.full_name} /></Row>
          <Row label="Relationship owner"><PersonChip name={vendor.relationship_owner?.full_name} /></Row>
        </dl>
      </Panel>

      <Panel title="Dates">
        <dl className="space-y-3">
          <Row label="Next reassessment">
            {next ? (
              <span style={days != null && days < 0 ? { color: TONE.danger.text } : undefined}>
                {fmt.date(next)} ({fmt.countdown(next)})
              </span>
            ) : 'After tiering'}
          </Row>
          <Row label="Added">{fmt.date(vendor.created_at)}</Row>
          <Row label="Last changed">{fmt.date(vendor.updated_at)}</Row>
          <Row label="Source">{sourceLabel(vendor)}</Row>
        </dl>
      </Panel>

      <Panel
        title="Contacts"
        action={canEdit ? (
          <button type="button" onClick={onAddContact} aria-label="Add contact" title="Add contact" className={ICON_BTN}>
            <Plus aria-hidden className="h-4 w-4" strokeWidth={2} />
          </button>
        ) : undefined}
      >
        {contacts.isLoading ? (
          <p className="text-[13px] leading-5 text-[#64707e]">Loading…</p>
        ) : listed.length === 0 ? (
          <p className="text-[13px] leading-5 text-[#64707e]">No contacts yet.</p>
        ) : (
          <ul className="space-y-3">
            {listed.map((c) => (
              <li key={c.id ?? 'record'} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium leading-5 text-[#1f2933]">
                    <span className="truncate">{c.name}</span>
                    {c.is_primary && <Star aria-label="Primary contact" className="h-3.5 w-3.5 shrink-0 text-[#0f766e]" strokeWidth={2} />}
                  </p>
                  <p className="truncate text-[12px] leading-4 text-[#64707e]">{contactLine(c)}</p>
                  <p className="text-[12px] leading-4" style={{ color: c.portal_access ? '#586472' : TONE.warning.text }}>
                    {c.portal_access ? 'Portal access' : 'No portal access'}
                  </p>
                </div>
                {canEdit && (
                  <button type="button" onClick={() => onEditContact(c)} aria-label={`Edit ${c.name}`} title="Edit" className={ICON_BTN}>
                    <Pencil aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Link
          href={recordHref(vendorId, { tab: 'assessments' })}
          className="mt-3 inline-block rounded-sm text-[13px] font-medium text-[#0f766e] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
        >
          Links and requests
        </Link>
      </Panel>

      {duplicates.length > 0 && (
        <Panel title="Possible duplicates" count={duplicates.length}>
          <ul className="space-y-2.5">
            {duplicates.map((m) => (
              <li key={m.id} className="text-[13px] leading-5 text-[#26323d]">
                <Link href={matchHref(m)} className="rounded-sm font-medium text-[#0f766e] underline underline-offset-2 hover:text-[#115e59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
                  {m.name}
                </Link>
                {matchNote(m)}
                <span className="block text-[12px] leading-4 text-[#64707e]">{cap(m.reason)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {row && (
        <Panel title="This engagement">
          <p className="text-[13px] font-medium leading-5 text-[#1f2933]">{row.name}</p>
          <p className="mt-1.5"><PersonChip name={row.owner_name} emptyLabel="No owner named" size="sm" /></p>
          {!isTiered(row) ? (
            <p className="mt-3 text-[13px] leading-5 text-[#64707e]">Not tiered yet</p>
          ) : progress ? (
            <div className="mt-3">
              <div
                role="progressbar"
                aria-label="Stages settled"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
                className="h-1.5 overflow-hidden rounded-full bg-[#e1e6eb]"
              >
                <div className="h-full rounded-full bg-[#0f766e]" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
              </div>
              <p className="mt-1.5 text-[12px] leading-4 text-[#64707e]">{progress.done} of {progress.total} stages settled</p>
            </div>
          ) : (
            <p className="mt-3 text-[13px] leading-5 text-[#64707e]">Not started yet</p>
          )}
        </Panel>
      )}
    </aside>
  );
}
