'use client';

// The agenda and what was decided: each item is a row that opens in place (the item the meeting is on opens by itself while it runs): its description, the records it is
// linked to (the first two and +N), what the committee decided (the outcome as a word, and the decision), the votes and what can be done to it (record or correct the outcome,
// edit, remove: all visible, none under the mouse). Add an item inline at the end; suggest items from pending approvals, exceptions and regulatory changes, or let AI parse a
// PDF or DOCX agenda. The data flow is the old page's (the same requests, keys and words); an outcome goes through the server's own call, never a status written by hand.
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListOrdered, Pencil, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { AccordionRow, Button, ChipList, ClampedText, EmptyState, ErrorState, IconButton, SkeletonLines, StatusPill } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useConfirm } from '@/components/ui/ds/useConfirm';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { formatCount, statusLabel, truncate } from '@/lib/format';
import { currentItem, canRecordOutcome, outlineLabel } from '@/lib/meetingRun';
import { agendaStatus, decisionOutcome } from '@/lib/statuses/committees';
import { statusPill } from '@/lib/status';
import { AgendaComposer, AutoPopulatePanel, EditAgendaPanel, OutcomePanel } from './AgendaForms';
import type { AgendaItem, Meeting, SuggestedItem } from './meetingTypes';
import { Section } from './MeetingSection';
import { VoteStrip } from './VoteStrip';

const SOURCE_LABEL: Record<string, string> = { document: 'Document', exception: 'Exception', regulatory_change: 'Regulatory change', manual: 'Manual' };

export function AgendaSection({ meeting, canCreate, canRun }: {
  meeting: Meeting;
  /** may add, edit and remove items */
  canCreate: boolean;
  /** may record outcomes */
  canRun: boolean;
}) {
  const meetingId = meeting.id;
  const { confirm, confirmDialog } = useConfirm();
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<AgendaItem | null>(null);
  const [deciding, setDeciding] = useState<AgendaItem | null>(null);
  const [filling, setFilling] = useState(false);
  const [openIds, setOpenIds] = useState<Record<number, boolean>>({});
  const upload = useRef<HTMLInputElement | null>(null);

  const agendaQ = useQuery<AgendaItem[]>({
    queryKey: ['meeting-agenda', meetingId],
    queryFn: async () => { const res = await committeeApi.getAgenda(meetingId); return Array.isArray(res.data) ? res.data : []; },
  });
  const suggestedQ = useQuery<SuggestedItem[]>({
    queryKey: ['meeting-suggested', meetingId],
    queryFn: async () => {
      const res = await committeeApi.getSuggestedAgendaItems(meetingId);
      const data = res.data as { suggested_items?: SuggestedItem[] } | SuggestedItem[];
      return Array.isArray(data) ? data : (data?.suggested_items ?? []);
    },
  });
  const sorted = useMemo(() => [...(agendaQ.data ?? [])].sort((a, b) => a.item_number - b.item_number), [agendaQ.data]);
  const current = currentItem(sorted, meeting.status);
  const suggested = suggestedQ.data ?? [];
  const count = meeting.agenda_item_count ?? sorted.length;
  const open = (it: AgendaItem): boolean => openIds[it.id] ?? current?.id === it.id;
  const closed = meeting.status === 'cancelled';
  const mayDecide = canRun && canRecordOutcome(meeting.status, meeting.minutes?.status);

  const parse = useReportedMutation({
    mutationFn: (file: File) => committeeApi.uploadAgendaForParse(meetingId, file),
    success: (r) => {
      const inserted = (r as { data?: { inserted?: number } }).data?.inserted ?? 0;
      return { title: `Imported ${inserted} agenda item${inserted === 1 ? '' : 's'}`, message: 'Edit any item to refine the parsed details.' };
    },
    failure: "Couldn't parse the agenda",
    fallback: 'Try a more structured document or add the items by hand.',
    retryable: false,
    invalidate: [['meeting-agenda', meetingId], ['meeting', meetingId], ['committee-meetings']],
  });
  const remove = useReportedMutation({
    mutationFn: (item: AgendaItem) => committeeApi.deleteAgendaItem(item.id),
    success: 'Agenda item removed',
    failure: "Couldn't remove the agenda item",
    invalidate: [['meeting-agenda', meetingId], ['meeting', meetingId], ['committee-meetings']],
  });
  const askRemove = async (item: AgendaItem) => {
    if (await confirm({
      title: `Remove agenda item ${item.item_number}?`,
      message: `“${truncate(item.title, 120).text}” is removed from the agenda. This cannot be undone. If votes have been cast on it, the server will not remove it.`,
      confirmLabel: 'Remove item',
      tone: 'danger',
    })) remove.mutate(item);
  };

  const tools = canCreate && !closed ? (
    <>
      <input ref={upload} type="file" accept=".pdf,.doc,.docx,.txt,.md" className="hidden" aria-hidden="true" tabIndex={-1}
        onChange={(e) => { const file = e.target.files?.[0]; if (file) parse.mutate(file); if (e.target) e.target.value = ''; }} />
      {suggested.length > 0 && <Button size="sm" leftIcon={<Sparkles aria-hidden />} onClick={() => setFilling(true)} title="Add pending approvals, exceptions and regulatory changes to the agenda">{`Suggest items (${formatCount(suggested.length)})`}</Button>}
      <Button size="sm" leftIcon={<Upload aria-hidden />} loading={parse.isPending} onClick={() => upload.current?.click()} title="Upload a PDF or DOCX agenda: it is parsed into items by rules and AI">{parse.isPending ? 'Parsing…' : 'Upload and AI parse'}</Button>
      <Button size="sm" leftIcon={<Plus aria-hidden />} onClick={() => setComposing(true)} disabled={composing}>Add item</Button>
    </>
  ) : undefined;

  return (
    <Section id="agenda" title={outlineLabel('agenda', meeting.status)} count={agendaQ.data || meeting.agenda_item_count !== undefined ? formatCount(count) : undefined} tools={tools}>
      {agendaQ.isError && !agendaQ.data ? (
        <ErrorState compact title="Couldn't load the agenda" message={errorMessage(agendaQ.error)} onRetry={() => { void agendaQ.refetch(); }} />
      ) : agendaQ.isLoading ? (
        <SkeletonLines lines={4} label="Loading the agenda" />
      ) : sorted.length === 0 ? (
        <EmptyState
          kind="firstUse"
          bare
          icon={ListOrdered}
          title="No agenda items yet"
          description={closed ? undefined : 'Add the first item, or suggest items from pending approvals and exceptions.'}
          action={canCreate && !closed && !composing ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setComposing(true)}>Add the first item</Button> : undefined}
        />
      ) : (
        <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border">
          {sorted.map((it) => {
            const decided = Boolean(it.outcome);
            const isCurrent = current?.id === it.id;
            const links = [
              it.linked_document_title && { label: `Document: ${it.linked_document_title}` },
              it.linked_risk_title && { label: `Risk exception: ${it.linked_risk_title}` },
              it.linked_regulatory_change_title && { label: `Regulatory change: ${it.linked_regulatory_change_title}` },
            ].filter(Boolean) as Array<{ label: string }>;
            const meta = [statusLabel(it.item_type), it.presenter_name, it.time_allocated_minutes ? `${it.time_allocated_minutes} min` : null, it.source_type && it.source_type !== 'manual' ? `From: ${SOURCE_LABEL[it.source_type] ?? statusLabel(it.source_type)}` : null].filter(Boolean).join(' · ');
            const isOpen = open(it);
            return (
              <li key={it.id}>
                <AccordionRow
                  level={3}
                  region={sorted.length <= 6}
                  lead={<span className={`grid h-[24px] w-[24px] place-items-center rounded-full text-ds-label tabular-nums ${isCurrent ? 'bg-ds-primary text-ds-on-primary' : decided ? 'bg-ds-success-soft text-ds-success' : 'bg-ds-surface-hover text-ds-fg-body'}`}>{it.item_number}</span>}
                  title={it.title}
                  meta={meta || undefined}
                  trailing={decided ? <StatusPill size="sm" {...statusPill(decisionOutcome, it.outcome)} /> : <StatusPill size="sm" {...statusPill(agendaStatus, it.status)} />}
                  open={isOpen}
                  onOpenChange={(next) => setOpenIds((s) => ({ ...s, [it.id]: next }))}
                >
                  {isOpen && (
                    <div className="space-y-[10px] pt-[4px]">
                      {it.description && <ClampedText text={it.description} lines={3} />}
                      {links.length > 0 && <ChipList items={links} label="related records" shown={2} />}
                      {decided && (
                        <div className="rounded-ds-control border border-ds-border bg-ds-success-soft px-[12px] py-[8px]">
                          <p className="flex flex-wrap items-center gap-[8px] text-ds-body text-ds-fg"><span className="font-[600]">Decision</span><StatusPill size="sm" {...statusPill(decisionOutcome, it.outcome)} /></p>
                          {it.decision_made ? <ClampedText text={it.decision_made} lines={4} className="mt-[4px]" /> : <p className="mt-[4px] text-ds-body text-ds-fg-muted">No decision text was recorded.</p>}
                        </div>
                      )}
                      <VoteStrip itemId={it.id} itemNumber={it.item_number} />
                      {(mayDecide || (canCreate && !closed)) && (
                        <div className="flex flex-wrap items-center gap-[6px]">
                          {mayDecide && <Button size="sm" variant={decided ? 'secondary' : 'primary'} onClick={() => setDeciding(it)}>{decided ? 'Correct outcome' : 'Record outcome'}</Button>}
                          {canCreate && !closed && (
                            <>
                              <IconButton label={`Edit agenda item ${it.item_number}`} onClick={() => setEditing(it)}><Pencil aria-hidden /></IconButton>
                              <IconButton label={`Remove agenda item ${it.item_number}`} disabled={remove.isPending} onClick={() => { void askRemove(it); }}><Trash2 aria-hidden /></IconButton>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </AccordionRow>
              </li>
            );
          })}
        </ul>
      )}
      {composing && <AgendaComposer meetingId={meetingId} onClose={() => setComposing(false)} />}
      <EditAgendaPanel meetingId={meetingId} item={editing} onClose={() => setEditing(null)} />
      <OutcomePanel meetingId={meetingId} item={deciding} onClose={() => setDeciding(null)} />
      <AutoPopulatePanel meetingId={meetingId} open={filling} onClose={() => setFilling(false)} />
      {confirmDialog}
    </Section>
  );
}
