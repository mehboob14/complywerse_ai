'use client';

// The internal (ERM) controls linked to a document: a table from 768px (cards below) with the paging the other registers have, so a document with 150 links is
// not a box four rows high. Unlink asks first (the kit's confirm dialog, not window.confirm), sends the same DELETE as ever and says what happened: the
// confirmation after the server answered, or its words with Retry. Who sees Unlink is the caller's (`canDelete`, unchanged).
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Shield, Unlink } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { EmptyState, IconButton, Pager, RegisterTable, useConfirm, useReportedMutation, type RegisterColumn } from '@/components/ui/ds';
import type { ControlLink } from './_types';
import { upperCode } from './mappingsModel';

const PAGE_SIZES = [10, 25, 50] as const;
const NOUN = { one: 'control', other: 'controls' };

export interface LinkedControlsProps {
  links: ControlLink[];
  documentId: number;
  documentTitle?: string;
  /** may take a link off (canDelete: the rights as the page always read them) */
  canDelete: boolean;
}

export function LinkedControls({ links, documentId, documentTitle, canDelete }: LinkedControlsProps) {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);

  const unlink = useReportedMutation({
    mutationFn: (v: { link: ControlLink; documentId: number }) => governanceApi.unlinkControl(v.link.id),
    success: (_, v) => ({ title: 'Control unlinked', message: `${upperCode(v.link.control_code) || 'The control'} is no longer linked to ${documentTitle ? `“${truncate(documentTitle, 80).text}”` : 'this document'}.` }),
    failure: "Couldn't unlink the control",
    onSuccess: (_, v) => { void queryClient.invalidateQueries({ queryKey: ['document-mappings', v.documentId] }); },
  });
  const ask = async (link: ControlLink) => {
    const named = `${upperCode(link.control_code) || 'This control'}${link.control_name ? ` (${truncate(link.control_name, 80).text})` : ''}`;
    const yes = await confirm({
      title: 'Unlink this control?',
      message: `${named} will no longer be linked to ${documentTitle ? `“${truncate(documentTitle, 80).text}”` : 'this document'}.`,
      confirmLabel: 'Unlink control',
      tone: 'danger',
    });
    if (yes) unlink.mutate({ link, documentId });
  };

  const rows = useMemo(() => {
    const start = (Math.min(page, Math.max(1, Math.ceil(links.length / pageSize))) - 1) * pageSize;
    return links.slice(start, start + pageSize);
  }, [links, page, pageSize]);

  const unlinkButton = (l: ControlLink) => (
    <IconButton label={`Unlink ${upperCode(l.control_code) || 'control'}`} disabled={unlink.isPending} onClick={() => { void ask(l); }}>
      <Unlink aria-hidden />
    </IconButton>
  );
  const columns: RegisterColumn<ControlLink>[] = [
    { key: 'code', header: 'Control', isRowHeader: true, width: 'w-[120px]', cell: (l) => <span className="font-[600] text-ds-fg [overflow-wrap:anywhere]">{upperCode(l.control_code) || '—'}</span> },
    {
      key: 'name', header: 'Name',
      cell: (l) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words" title={l.control_name ?? undefined}>{l.control_name || '—'}</span>
          {/* the server stores no link type or note for a control link (it always says "linked"): shown only if one ever comes */}
          {(l.notes || (l.link_type && l.link_type !== 'linked')) && (
            <span className="mt-[2px] block break-words text-ds-label text-ds-fg-muted">{[l.link_type && l.link_type !== 'linked' ? l.link_type.replace(/_/g, ' ') : '', l.notes ?? ''].filter(Boolean).join(' · ')}</span>
          )}
        </div>
      ),
    },
  ];
  if (canDelete) columns.push({ key: 'actions', header: 'Actions', align: 'right', width: 'w-[64px]', card: 'hide', cell: unlinkButton });

  return (
    <>
      <RegisterTable<ControlLink>
        caption="Internal controls linked to this document"
        columns={columns}
        rows={rows}
        getRowId={(l) => l.id}
        cardTitle={(l) => (
          <span className="block break-words"><span className="font-[600] text-ds-fg">{upperCode(l.control_code) || '—'}</span>{l.control_name ? <span className="font-normal text-ds-fg-body"> {l.control_name}</span> : null}</span>
        )}
        cardActions={canDelete ? unlinkButton : undefined}
        empty={<EmptyState bare kind="firstUse" icon={Shield} title="No internal controls linked" info="Controls linked to this document appear here." />}
        footer={links.length > 0 ? (
          <Pager page={page} pageSize={pageSize} total={links.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} pageSizes={PAGE_SIZES} noun={NOUN} />
        ) : undefined}
      />
      {confirmDialog}
    </>
  );
}
