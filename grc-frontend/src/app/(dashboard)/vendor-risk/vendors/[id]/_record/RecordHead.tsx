'use client';

// The head of a vendor's record: the name (the page's one <h1>), what kind of supplier it is, its tier, status, grade and data facts as pills with words, the one primary step (tier it,
// while it has no tier), Edit, and a menu for the rest. The rights are the ones the page has always checked and the server enforces (`vendors:edit`, `assessments:edit`, each with the
// risk-edit fallback every vendor-risk write accepts); nothing here widens them.
import { BadgeCheck, Copy, FileText, Layers, LogOut, Pencil, UserPlus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { Button, Menu, StatusPill, useNotify, type MenuItem } from '@/components/ui/ds';
import { statusLabel } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { vendorGrade, vendorLifecycle, vendorTier } from '@/lib/statuses/vendor';
import { BACK, metaLine } from '../../../_lib/recordShellModel';
import { classificationTone, metaParts, recordHref, tierHref, webHost, webHref } from '../../../_lib/vendorRecordModel';
import { WorstOfNote } from '../_tpra/EngagementsPanel';
import type { VendorRecord } from './recordData';

export interface HeadActions {
  canEdit: boolean;
  canTier: boolean;
  tiered: boolean;
  /** the whole relationship is ending (archived, or the exit has started) */
  closing: boolean;
  archived: boolean;
  /** the engagement "Tier engagement" is for (null: General) and whether it already has a tier (the button then says Re-tier) */
  target: number | null;
  targetTiered: boolean;
  /** the engagement list has been read (adding one needs it) and the exit read has (starting one needs it) */
  canAddEngagement: boolean;
  canStartExit: boolean;
  onEdit: () => void;
  onAddEngagement: () => void;
  onAddContact: () => void;
  onStartExit: () => void;
  /** "VAT check" is a disclosure of the Overview: go there and bring it into view */
  onVat: () => void;
}

export default function RecordHead({ vendor, vendorId, grade, onLifecycleTab, a }: {
  vendor: VendorRecord;
  vendorId: number;
  /** the supplier's grade from the engagement list ("A".."F"), when it has one */
  grade: string | null;
  /** the Lifecycle tab is open: its own step already offers the tier, so the head does not repeat it */
  onLifecycleTab: boolean;
  a: HeadActions;
}) {
  const router = useRouter();
  const notify = useNotify();
  const meta = metaParts(vendor);
  const website = webHref(vendor.website);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${recordHref(vendorId)}`);
      notify.success('Link copied');
    } catch {
      notify.error('The link could not be copied. Copy it from the address bar.', { title: 'Not copied' });
    }
  };

  const items: MenuItem[] = [
    { key: 'tier', label: a.targetTiered ? 'Re-tier engagement' : 'Tier engagement', icon: Layers, onSelect: () => router.push(tierHref(vendorId, a.target)), hidden: !a.canTier || a.closing },
    { key: 'engagement', label: 'Add engagement', icon: Users, onSelect: a.onAddEngagement, hidden: !a.canEdit || !a.canAddEngagement || a.archived },
    { key: 'contact', label: 'Add contact', icon: UserPlus, onSelect: a.onAddContact, hidden: !a.canEdit },
    { key: 'summary', label: 'Summary report', icon: FileText, onSelect: () => router.push(`/vendor-risk/vendors/${vendorId}/summary`) },
    { key: 'vat', label: 'VAT check', icon: BadgeCheck, onSelect: a.onVat },
    { key: 'copy', label: 'Copy link', icon: Copy, onSelect: () => { void copyLink(); } },
    { key: 'offboard', label: 'Start offboarding', icon: LogOut, danger: true, onSelect: a.onStartExit, hidden: !a.canEdit || a.closing || !a.canStartExit },
  ];

  const tierWord = a.tiered ? vendorTier.label(vendor.tier) : null;
  const cls = classificationTone(vendor.data_classification);

  return (
    <PageHeader
      variant="page"
      title={vendor.name}
      back={BACK}
      meta={(meta.length > 0 || website) ? (
        <>
          {metaLine(meta)}
          {website && (
            <>
              {meta.length > 0 ? ' · ' : ''}
              <a href={website} target="_blank" rel="noopener noreferrer" className="rounded-ds-control font-medium text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
                {webHost(vendor.website)}
              </a>
            </>
          )}
        </>
      ) : undefined}
      chips={(
        <>
          <span className="inline-flex items-center">
            <StatusPill {...statusPill(vendorTier, a.tiered ? vendor.tier : 'not_tiered')} label={tierWord ? `${tierWord} tier` : 'Not tiered'} />
            <WorstOfNote vendorId={vendorId} />
          </span>
          {vendor.status && <StatusPill {...statusPill(vendorLifecycle, vendor.status)} />}
          {a.archived && <StatusPill tone="neutral" label="Archived" />}
          {grade && <StatusPill {...statusPill(vendorGrade, grade)} />}
          {vendor.holds_personal_data === true && <StatusPill tone="warning" label="Holds personal data" />}
          {vendor.data_classification && <StatusPill tone={cls} label={statusLabel(vendor.data_classification)} />}
        </>
      )}
      actions={(
        <>
          {a.canTier && !a.tiered && !a.closing && !onLifecycleTab && <Button variant="primary" href={tierHref(vendorId, a.target)}>Tier engagement</Button>}
          {a.canEdit && <Button leftIcon={<Pencil aria-hidden />} onClick={a.onEdit}>Edit</Button>}
          <Menu label="More" items={items} />
        </>
      )}
    />
  );
}
