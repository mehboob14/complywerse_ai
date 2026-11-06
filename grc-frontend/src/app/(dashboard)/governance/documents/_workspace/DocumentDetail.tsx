'use client';

/**
 * The details of one document over the library's list (the Facet explorer's drawer): the kit's SidePanel (an overlay with a scrim at every width, a bottom sheet on a phone;
 * focus kept inside, Escape closes one layer, focus returns to the row), with ONE scrolling body of sections instead of tabs: the facts and attestation, what the document waits
 * for (who, the acknowledgements, the recent activity), its versions and its frameworks. The sections are the library's own (DocumentDrawer.tsx exports them), so the facts, the
 * words and the requests are what they have always been: the workflow is read for this one document only while it is open (the same cache entry as the life-cycle card).
 * Open document, Download and Edit stay in view under the body; Archive and Restore are in the More menu; previous / next walk the list as it is shown.
 */
import { Archive, ArchiveRestore, ArrowUpRight, ChevronDown, ChevronUp, Download, Pencil } from 'lucide-react';
import { Button, IconButton, Menu, SidePanel, StatusPill, type MenuItem } from '@/components/ui/ds';
import { documentStatus, statusPill } from '@/lib/status';
import { Frameworks, Overview, Section, Workflow } from './DocumentDrawer';
import { inForceText, inWorkflow, versionText } from './drawerLogic';
import { LifecycleDots, type GovDoc } from './lib';
import { typeLabel, type Lookups } from './libraryModel';
import { Versions } from './Versions';

export interface DocumentDetailProps {
  /** null = closed */
  doc: GovDoc | null;
  lookups: Lookups;
  /** attestation "4 of 5" (may be empty) */
  counts: Record<number, { done: number; total: number }>;
  activeFrameworks: string[];
  onClose: () => void;
  onOpenDoc: (id: number) => void;
  onPickFramework: (id: number) => void;
  onEdit: (doc: GovDoc) => void;
  canEdit: boolean;
  onDownload: (doc: GovDoc) => void;
  onArchive: (doc: GovDoc) => void;
  canArchive: boolean;
  onRestore: (doc: GovDoc) => void;
  canRestore: boolean;
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
}

/** The row (or card) the details were opened from, found again when focus has to go back to it. */
const rowOf = (id: number | null) => (): HTMLElement | null => {
  if (id == null || typeof document === 'undefined') return null;
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-record-row="${id}"]`));
  const row = rows.find((r) => r.getClientRects().length > 0) ?? null;
  return row?.querySelector<HTMLElement>('a[href], button') ?? row;
};

export function DocumentDetail(props: DocumentDetailProps) {
  const { doc, lookups, counts, activeFrameworks, onClose, onOpenDoc, onPickFramework, onEdit, canEdit, onDownload, onArchive, canArchive, onRestore, canRestore, onStep, hasPrev, hasNext } = props;
  const more: MenuItem[] = doc ? [
    { key: 'archive', label: 'Archive', icon: Archive, onSelect: () => onArchive(doc), danger: true, hidden: !canArchive },
    { key: 'restore', label: 'Restore', icon: ArchiveRestore, onSelect: () => onRestore(doc), hidden: !canRestore },
  ] : [];
  const inForce = doc ? inForceText(doc) : null;
  const subtitle = doc ? [doc.document_code, typeLabel(doc.doc_type), doc.current_version ? versionText(doc.current_version) : null, inForce].filter(Boolean).join(' · ') : '';
  return (
    <SidePanel
      open={!!doc}
      onClose={onClose}
      title={<span dir="auto" className="line-clamp-3 break-words" title={doc?.title}>{doc?.title}</span>}
      subtitle={subtitle || undefined}
      dockFrom={Infinity}
      width="md"
      restoreFocus={rowOf(doc?.id ?? null)}
      actions={doc && (
        <>
          <IconButton label="Previous document" aria-disabled={!hasPrev || undefined} onClick={() => { if (hasPrev) onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
          <IconButton label="Next document" aria-disabled={!hasNext || undefined} onClick={() => { if (hasNext) onStep(1); }}><ChevronDown aria-hidden /></IconButton>
          <Menu label="More actions" iconOnly items={more} />
        </>
      )}
      footer={doc && (
        <div className="flex flex-wrap items-center gap-[8px]">
          <Button variant="primary" onClick={() => onOpenDoc(doc.id)} rightIcon={<ArrowUpRight aria-hidden />}>Open document</Button>
          <Button onClick={() => onDownload(doc)} leftIcon={<Download aria-hidden />}>Download</Button>
          {canEdit && <Button onClick={() => onEdit(doc)} title="Edit the document's details" leftIcon={<Pencil aria-hidden />}>Edit</Button>}
        </div>
      )}
    >
      {doc && (
        // keyed by the document: a search box, a "Show more" or a loading state never carries over to the next one
        <div key={doc.id} data-doc-detail={doc.id}>
          <div className="mb-[16px] flex flex-wrap items-center gap-[8px]">
            <StatusPill {...statusPill(documentStatus, doc.status)} />
            {inWorkflow(doc.status) && <span aria-hidden><LifecycleDots status={doc.status} showLabel={false} /></span>}
          </div>
          <Overview doc={doc} lookups={lookups} counts={counts} />
          <div className="mt-5 border-t border-ds-border pt-4"><Workflow doc={doc} onOpenDoc={onOpenDoc} /></div>
          <div className="mt-5 border-t border-ds-border pt-4"><Section title="Versions" first><Versions doc={doc} /></Section></div>
          <div className="mt-5 border-t border-ds-border pt-4"><Section title="Frameworks" first><Frameworks doc={doc} lookups={lookups} active={activeFrameworks} onPick={onPickFramework} /></Section></div>
        </div>
      )}
    </SidePanel>
  );
}
