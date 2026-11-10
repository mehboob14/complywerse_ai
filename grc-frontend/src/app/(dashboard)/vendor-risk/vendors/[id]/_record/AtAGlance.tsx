'use client';

// "At a glance": the facts a person wants beside every tab (on the Lifecycle tab too, where the old right column vanished): who owns the supplier, its dates, its contacts, how far the
// engagement picked has come, and what it may duplicate. Facts, not prose (D41). Every read here says what it is doing: the contacts have a loading line, an error with Retry and an
// empty sentence (a failed read is never "No contacts yet"); the duplicates are read only when the person opens that section; the stage count comes from the Lifecycle read when the
// Lifecycle tab has made it (nothing is fetched here just to count).
import Link from 'next/link';
import { Pencil, Plus, Star } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Disclosure, ErrorState, Fact, IconButton, PersonChip, ProgressBar, SectionCard, SkeletonLines } from '@/components/ui/ds';
import { formatDate, formatRelative } from '@/lib/format';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import VendorLogo from '../../../_lib/VendorLogo';
import type { EngagementList } from '../../../_lib/engagementsApi';
import { lifecycleApi, lifecycleKey, type LifecycleView } from '../../../_lib/lifecycleApi';
import { matchHref, matchNote } from '../../../_lib/intakeModel';
import type { SupplierContact } from '../../../_lib/portalApi';
import { reviewWords } from '../../../_lib/recordShellModel';
import { useDuplicates } from '../../../_lib/vendorRecordApi';
import { contactLine, isTiered, nextReview, openScopes, recordHref, settled, sourceLabel } from '../../../_lib/vendorRecordModel';
import { useRecordContacts, type VendorRecord } from './recordData';

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

export default function AtAGlance({ vendorId, vendor, engagementId, engagements, engagementsFailed, onRetryEngagements, canEdit, archived = false, late, onAddContact, onEditContact }: {
  vendorId: number;
  vendor: VendorRecord;
  /** the engagement the page picked; null is General */
  engagementId: number | null;
  engagements: EngagementList | undefined;
  engagementsFailed: boolean;
  onRetryEngagements: () => void;
  canEdit: boolean;
  /** the supplier is archived: its contacts cannot be read */
  archived?: boolean;
  /** the first paint is out: the logo may be fetched now */
  late: boolean;
  onAddContact: () => void;
  onEditContact: (contact: SupplierContact) => void;
}) {
  const contacts = useRecordContacts(vendorId, !archived);
  const [wantDuplicates, setWantDuplicates] = useState(false);
  const duplicates = useDuplicates(String(vendor.name ?? ''), String(vendor.website ?? ''), vendorId, wantDuplicates);

  // The Lifecycle tab's own read, when it has made it: enabled false, so this never asks, it only shows what is already there.
  const life = useQuery<LifecycleView>({
    queryKey: lifecycleKey(vendorId, engagementId),
    queryFn: async () => (await lifecycleApi.get(vendorId, engagementId)).data,
    enabled: false,
  });

  const items = engagements?.items;
  const row = openScopes(items).find((e) => (engagementId ? e.id === engagementId : e.is_general)) ?? null;
  const progress = settled(life.data?.stages);
  const listed = (contacts.data ?? []).filter((c) => !c.archived_at);
  const next = nextReview(items, vendor.next_reassessment_date);
  const review = reviewWords(items, vendor.next_reassessment_date);

  return (
    <aside aria-label="About this supplier" className="flex min-w-0 flex-col gap-[16px]">
      <SectionCard id="glance" title="At a glance">
        <div className="flex items-center gap-[12px]">
          <span className="grid h-[40px] w-[40px] shrink-0 place-items-center">{late && <VendorLogo vendorId={vendor.id} name={String(vendor.name ?? '')} size={40} />}</span>
          <p className="min-w-0 break-words text-ds-body font-[500] text-ds-fg">{vendor.name}</p>
        </div>
        <dl className="mt-[12px] flex flex-col gap-[12px]">
          <Fact label="Business owner"><PersonChip name={vendor.owner?.full_name} /></Fact>
          <Fact label="Security owner"><PersonChip name={vendor.security_owner?.full_name} /></Fact>
          <Fact label="Relationship owner"><PersonChip name={vendor.relationship_owner?.full_name} /></Fact>
          <Fact label="Next reassessment">
            {next ? <span className={review.tone === 'danger' ? 'text-ds-danger' : undefined}>{formatDate(next, { calendar: true })} ({formatRelative(next)})</span> : 'After tiering'}
          </Fact>
          <Fact label="Added">{formatDate(vendor.created_at)}</Fact>
          <Fact label="Last changed">{formatDate(vendor.updated_at)}</Fact>
          <Fact label="Source">{sourceLabel(vendor)}</Fact>
        </dl>
      </SectionCard>

      <SectionCard
        id="contacts"
        title="Contacts"
        actions={canEdit ? <IconButton label="Add contact" onClick={onAddContact}><Plus aria-hidden /></IconButton> : undefined}
      >
        {archived ? (
          <p className="text-ds-body text-ds-fg-muted">Not shown while the supplier is archived.</p>
        ) : contacts.isPending ? (
          <SkeletonLines lines={3} label="Loading the contacts" />
        ) : contacts.isError ? (
          <ErrorState compact title="Couldn’t load the contacts" message={errorMessage(contacts.error)} onRetry={() => { void contacts.refetch(); }} />
        ) : listed.length === 0 ? (
          <p className="text-ds-body text-ds-fg-muted">No contacts yet.</p>
        ) : (
          <ul className="flex flex-col gap-[12px]">
            {listed.map((c) => (
              <li key={c.id ?? 'record'} className="flex items-start justify-between gap-[8px]">
                <div className="min-w-0">
                  <p className="flex items-center gap-[6px] text-ds-body font-[500] text-ds-fg">
                    <span className="truncate">{c.name}</span>
                    {c.is_primary && <Star aria-label="Primary contact" className="h-[14px] w-[14px] shrink-0 text-ds-primary-text" strokeWidth={2} />}
                  </p>
                  <p className="break-words text-ds-label text-ds-fg-muted">{contactLine(c)}</p>
                  <p className={c.portal_access ? 'text-ds-label text-ds-fg-muted' : 'text-ds-label text-ds-warning'}>{c.portal_access ? 'Portal access' : 'No portal access'}</p>
                </div>
                {canEdit && <IconButton label={`Edit ${c.name}`} onClick={() => onEditContact(c)}><Pencil aria-hidden /></IconButton>}
              </li>
            ))}
          </ul>
        )}
        <Link
          href={recordHref(vendorId, { tab: 'assessments' })}
          className="mt-[12px] inline-flex min-h-ds-control items-center rounded-ds-control text-ds-body font-[500] text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring"
        >
          Links and requests
        </Link>
      </SectionCard>

      {(row || engagementsFailed) && (
        <SectionCard id="this-engagement" title="This engagement">
          {engagementsFailed ? (
            <ErrorState compact title="Couldn’t load the engagements" onRetry={onRetryEngagements} />
          ) : row && (
            <>
              <p className="break-words text-ds-body font-[500] text-ds-fg">{row.name}</p>
              <p className="mt-[6px]"><PersonChip name={row.owner_name} emptyLabel="No owner named" size={20} /></p>
              {!isTiered(row) ? (
                <p className="mt-[12px] text-ds-body text-ds-fg-muted">Not tiered yet</p>
              ) : progress ? (
                <div className="mt-[12px]">
                  <ProgressBar value={Math.round((progress.done / progress.total) * 100)} label="Stages settled" valueText={`${progress.done} of ${progress.total} stages settled`} />
                </div>
              ) : (
                <p className="mt-[12px] text-ds-body text-ds-fg-muted">Open the Lifecycle tab to see how far it has come.</p>
              )}
            </>
          )}
        </SectionCard>
      )}

      <div className="rounded-ds-card border border-ds-border bg-ds-surface px-[8px]">
        <Disclosure label="Possible duplicates" level={2} onOpenChange={(open) => { if (open) setWantDuplicates(true); }}>
          {duplicates.isPending && wantDuplicates && duplicates.fetchStatus !== 'idle' ? (
            <SkeletonLines lines={2} label="Looking for duplicates" />
          ) : duplicates.isError ? (
            <ErrorState compact title="Couldn’t check for duplicates" onRetry={() => { void duplicates.refetch(); }} />
          ) : (duplicates.data ?? []).length === 0 ? (
            <p className="px-[8px] pb-[8px] text-ds-body text-ds-fg-muted">No other supplier looks like this one.</p>
          ) : (
            <ul className="flex flex-col gap-[8px] px-[8px] pb-[8px]">
              {(duplicates.data ?? []).map((m) => (
                <li key={m.id} className="text-ds-body text-ds-fg-body">
                  <Link href={matchHref(m)} className="rounded-ds-control font-[500] text-ds-primary-text underline underline-offset-2 hover:text-ds-primary-hover focus-visible:outline-none focus-visible:shadow-ds-ring">{m.name}</Link>
                  {matchNote(m)}
                  <span className="block text-ds-label text-ds-fg-muted">{cap(m.reason)}</span>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      </div>
    </aside>
  );
}
