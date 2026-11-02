'use client';

// "Link internal control": the drawer that links one of the tenant's internal (ERM) controls to the document. The same request as ever (POST
// /governance/mappings/control with the document, the control, the link type, the note and `force_relink`); a click on a control writes at once, as it always did.
// What changed is how it talks: a control that belongs to another document asks in the kit's confirm dialog before it is moved (it was window.confirm), a
// refused link is said inline in the drawer in the server's words and the drawer stays open, a linked one closes it and says so in a toast, and the list has a
// state for loading, failing and being empty. The controls are real buttons with arrow-key movement between them.
import { useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Shield } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { formatCount, truncate } from '@/lib/format';
import { RightSlidePanel } from '@/components/ui';
import { Button, ErrorState, FormField, Notice, Select, SkeletonLines, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import type { InternalControl } from './_types';
import { LINK_LIST_LIMIT, LINK_TYPES, filterControls, optionAfter, relinkOf, upperCode } from './mappingsModel';
import { SearchBox } from './_ui';

export interface LinkPanelProps {
  open: boolean;
  onClose: () => void;
  documentId: number;
  documentTitle?: string;
  /** the tenant's internal controls (the read the page already makes) */
  controls: { data: InternalControl[] | undefined; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
  /** ids of the controls already linked to this document (hidden here) */
  linkedIds: ReadonlySet<number>;
  /** titles of the documents the page has loaded, to say which document a control is on now (the document's own view has none: "another document") */
  titleById: ReadonlyMap<number, string>;
}

const ROW_RING = 'focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

export function LinkPanel({ open, onClose, documentId, documentTitle, controls, linkedIds, titleById }: LinkPanelProps) {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const list = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [linkType, setLinkType] = useState('implements');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const doc = documentTitle ? `“${truncate(documentTitle, 80).text}”` : 'this document';

  const reset = () => { setSearch(''); setNotes(''); setError(null); };
  const close = () => { reset(); onClose(); };

  const link = useReportedMutation({
    mutationFn: (v: { control: InternalControl; relink: boolean }) => governanceApi.linkControl({
      document_id: documentId,
      internal_control_id: v.control.id,
      link_type: linkType,
      notes: notes || undefined,
      force_relink: v.relink,
    }),
    success: (_, v) => ({ title: v.relink ? 'Control re-linked' : 'Control linked', message: `${upperCode(v.control.control_id)} is now linked to ${doc}.` }),
    failure: "Couldn't link the control",
    toast: 'success',                                    // a failure is said in the drawer, once
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['document-mappings', documentId] }); close(); },
    onError: (e) => setError(errorMessage(e, 'Failed to link control to document.')),
  });

  const choose = async (control: InternalControl) => {
    setError(null);
    const { relink, fromDocumentId } = relinkOf(control, documentId);
    if (relink) {
      const known = fromDocumentId !== null ? titleById.get(fromDocumentId) : undefined;
      const from = known ? `“${truncate(known, 80).text}”` : 'another document';
      const yes = await confirm({
        title: 'Re-link this control?',
        message: `${upperCode(control.control_id)} is linked to ${from}. Link it to ${doc} instead? It will come off ${from}.`,
        confirmLabel: 'Re-link control',
      });
      if (!yes) return;
    }
    link.mutate({ control, relink });
  };

  const matches = filterControls(controls.data, search, linkedIds);
  const shown = matches.slice(0, LINK_LIST_LIMIT);

  // arrow keys move between the controls (each is a button: Tab and Enter work as ever)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('button[data-control-row]') ?? []);
    const to = optionAfter(rows.length, rows.indexOf(document.activeElement as HTMLElement), e.key);
    if (to === null || to < 0) return;
    e.preventDefault();
    rows[to].focus();
  };

  return (
    <>
      <RightSlidePanel isOpen={open} onClose={close} title="Link internal control" width="w-full max-w-[640px]"
        footer={<div className="flex justify-end"><Button onClick={close}>Close</Button></div>}>
        <div className="flex flex-col gap-[12px]">
          <p className="line-clamp-2 break-words text-ds-body text-ds-fg-muted" title={documentTitle}>Linking to {doc}</p>

          {error && <Notice tone="danger" title="Not linked">{error}</Notice>}

          <SearchBox value={search} onChange={setSearch} label="Search internal controls" placeholder="Search by ID or name" />

          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            <FormField label="Link type">
              <Select value={linkType} onChange={(e) => setLinkType(e.target.value)}>
                {LINK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Notes" optional>
              <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </div>

          {controls.isLoading ? (
            <SkeletonLines lines={5} label="Loading the internal controls" />
          ) : controls.isError ? (
            <ErrorState compact title="Couldn't load the internal controls" message={errorMessage(controls.error)} onRetry={() => controls.refetch()} />
          ) : shown.length === 0 ? (
            <div className="rounded-ds-card border border-ds-border px-[12px] py-[24px] text-center">
              <p className="text-ds-body text-ds-fg-muted">{search ? 'No matches' : 'None available'}</p>
              <p className="mt-[4px] text-ds-label text-ds-fg-muted">Controls linked to this document are hidden.</p>
            </div>
          ) : (
            <div ref={list} onKeyDown={onKeyDown} aria-busy={link.isPending || undefined} className="max-h-[min(50vh,420px)] divide-y divide-ds-border overflow-y-auto overscroll-contain rounded-ds-card border border-ds-border">
              {shown.map((control) => {
                const onOther = control.source_document_id && control.source_document_id !== documentId;
                return (
                  <button
                    key={control.id}
                    type="button"
                    data-control-row=""
                    onClick={() => { void choose(control); }}
                    disabled={link.isPending}
                    className={`flex w-full items-center gap-[12px] bg-ds-surface px-[12px] py-[8px] text-left hover:bg-ds-surface-hover disabled:cursor-not-allowed disabled:opacity-50 ${ROW_RING}`}
                  >
                    <span aria-hidden className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-ds-control bg-ds-primary-soft text-ds-primary-text">
                      <Shield strokeWidth={1.75} className="h-[16px] w-[16px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-ds-body font-[600] text-ds-fg">{upperCode(control.control_id)}</span>
                      <span className="line-clamp-2 break-words text-ds-body text-ds-fg-body" title={control.name}>{control.name}</span>
                      {control.category && (
                        <span className="mt-[2px] block break-words text-ds-label text-ds-fg-muted">{control.category}{control.sub_category ? ` / ${control.sub_category}` : ''}</span>
                      )}
                      {onOther && (
                        <span className="mt-[2px] block break-words text-ds-label text-ds-warning">
                          Linked to {titleById.get(control.source_document_id as number) || 'another document'}
                        </span>
                      )}
                    </span>
                    <span className={`inline-flex shrink-0 items-center gap-[4px] text-ds-label font-[600] ${onOther ? 'text-ds-warning' : 'text-ds-primary-text'}`}>
                      <Plus aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px]" />
                      {onOther ? 'Re-link' : 'Link'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {matches.length > LINK_LIST_LIMIT && (
            <Notice tone="info" role="status" title={`Showing the first ${LINK_LIST_LIMIT} of ${formatCount(matches.length)}`}>Search to narrow the list.</Notice>
          )}
        </div>
      </RightSlidePanel>
      {confirmDialog}
    </>
  );
}
