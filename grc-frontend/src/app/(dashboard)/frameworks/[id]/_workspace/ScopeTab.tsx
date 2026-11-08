'use client';

// Scope & decisions: every request to put a requirement in or out of scope, and the reviewer's side of it. The server saves EVERY such request as
// waiting and applies it to the requirement only when a reviewer approves it (governance/routers/applicability.py), so this tab is where a request is
// settled. It used to live in a tab nothing could open, which left every request waiting for ever. Who may decide is what the page always checked
// (`frameworks:framework_library:edit`); the server itself lets any signed-in person decide, which is listed as a gap, not widened here.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { governanceApi, evidenceApi } from '@/lib/api';
import {
  AccordionRow, Button, Combobox, EmptyState, ErrorState, FormField, ReadOnlyNote, SectionCard, SegmentedControl, Select, SkeletonRows,
  StatusPill, Textarea, useReportedMutation,
} from '@/components/ui/ds';
import { apiErrorText, safeDetail } from '@/lib/apiError';
import { formatDateTime, formatCount, NOT_SET } from '@/lib/format';
import {
  controlOfDecision, SCOPE_FILTERS, scopeCounts, scopeEffect, scopeList, type ControlLite, type ScopeFilter, type ScopeRecordLite,
} from '@/lib/journeyModel';
import { scopeDecision } from '@/lib/statuses/frameworkJourney';

export interface ScopeRecord extends ScopeRecordLite {
  control_reference?: string | null;
  control_title?: string | null;
  justification?: string | null;
  requested_by_name?: string | null;
  reviewed_by_name?: string | null;
  review_comment?: string | null;
  owner_id?: number | null;
  owner_name?: string | null;
  implementation_status?: string | null;
  linked_evidence_id?: number | null;
}

const IMPLEMENTATION_STATUS = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'implemented', label: 'Implemented' },
  { value: 'verified', label: 'Verified' },
  { value: 'not_applicable', label: 'Not applicable' },
];

interface Props {
  journeyId: number;
  appFwId: number | null;
  records: ScopeRecord[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  controls: (ControlLite & { control_code?: string })[] | undefined;
  canEdit: boolean;
  users: Array<{ id: number; name: string }>;
}

export default function ScopeTab({ journeyId, appFwId, records, loading, error, onRetry, controls, canEdit, users }: Props) {
  const [filter, setFilter] = useState<ScopeFilter>('pending');
  const [opened, setOpened] = useState(false);
  const counts = scopeCounts(records);
  const list = scopeList(records, filter);

  // The evidence library is only fetched once a row has been opened (it is the whole library).
  const evidenceLib = useQuery({
    queryKey: ['evidence-all'],
    queryFn: async () => (await evidenceApi.getAll()).data as unknown as Array<{ id: number; name?: string; title?: string; file_name?: string }>,
    enabled: opened && canEdit,
    staleTime: 60_000,
  });

  const details = useReportedMutation({
    mutationFn: ({ id, data }: { id: number; data: { owner_id?: number | null; implementation_status?: string | null; linked_evidence_id?: number | null } }) =>
      governanceApi.updateApplicabilityDetails(id, data),
    success: 'Saved',
    failure: "Couldn't save the change",
    invalidate: [['applicability']],
  });
  const review = useReportedMutation({
    mutationFn: ({ id, status, comment }: { id: number; status: 'approved' | 'rejected'; comment: string }) =>
      governanceApi.reviewApplicability(id, { status, review_comment: comment }),
    success: (_d, v) => (v.status === 'approved'
      ? { title: 'Request approved', message: 'The requirement now follows the decision.' }
      : { title: 'Request turned down', message: 'The requirement stays as it was.' }),
    failure: "Couldn't record the decision",
    // an approved decision flips the requirement's scope, so the list and the journey's numbers are read again
    invalidate: [['applicability'], ['certification-controls', journeyId], ['certification-progress', journeyId]],
  });

  if (!appFwId) {
    return <EmptyState kind="firstUse" title="No scope decisions here" description="This journey is not linked to a framework in the library, so its requirements have no scope decisions." bare />;
  }

  return (
    <SectionCard
      id="scope"
      title="Scope & decisions"
      meta={loading || error ? undefined : `${formatCount(counts.pending)} waiting · ${formatCount(counts.out)} out of scope`}
      info="Every request to put a requirement in or out of scope waits for a reviewer. The requirement stays as it is until the request is approved."
    >
      {loading ? (
        <SkeletonRows rows={5} />
      ) : error ? (
        <ErrorState title="Couldn't load the scope decisions" message={safeDetail(apiErrorText(error, 'Please try again.'))} onRetry={onRetry} />
      ) : (
        <div className="space-y-[12px]">
          {!canEdit && <ReadOnlyNote>You can read the decisions. Deciding them needs the right to edit frameworks.</ReadOnlyNote>}
          <SegmentedControl
            label="Show decisions"
            name="scope-filter"
            value={filter}
            onChange={setFilter}
            options={SCOPE_FILTERS.map((f) => ({ value: f.key, label: `${f.label} ${formatCount(counts[f.key])}` }))}
          />
          {list.length === 0 ? (
            <EmptyState
              kind={counts.all === 0 ? 'firstUse' : 'noMatches'}
              title={counts.all === 0 ? 'No scope requests yet' : filter === 'pending' ? 'Nothing is waiting for a reviewer' : 'No decisions in this list'}
              description={counts.all === 0 ? 'When someone asks to put a requirement in or out of scope, the request appears here.' : undefined}
              onClearFilters={counts.all === 0 || filter === 'all' ? undefined : () => setFilter('all')}
              bare
            />
          ) : (
            <ul className="space-y-[8px]">
              {list.map((r) => (
                <li key={r.id}>
                  <DecisionRow
                    record={r}
                    control={controlOfDecision(r, controls)}
                    canEdit={canEdit}
                    users={users}
                    evidence={evidenceLib.data}
                    evidenceFailed={!!evidenceLib.error}
                    busy={review.isPending || details.isPending}
                    onOpen={() => setOpened(true)}
                    onDecide={(status, comment) => review.mutate({ id: r.id, status, comment })}
                    onDetails={(data) => details.mutate({ id: r.id, data })}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function DecisionRow({
  record, control, canEdit, users, evidence, evidenceFailed, busy, onOpen, onDecide, onDetails,
}: {
  record: ScopeRecord;
  control: (ControlLite & { control_code?: string }) | null;
  canEdit: boolean;
  users: Array<{ id: number; name: string }>;
  evidence: Array<{ id: number; name?: string; title?: string; file_name?: string }> | undefined;
  evidenceFailed: boolean;
  busy: boolean;
  onOpen: () => void;
  onDecide: (status: 'approved' | 'rejected', comment: string) => void;
  onDetails: (data: { owner_id?: number | null; implementation_status?: string | null; linked_evidence_id?: number | null }) => void;
}) {
  const [comment, setComment] = useState('');
  const pending = record.status === 'pending';
  const inScopeNow = control ? control.is_applicable !== false : null;
  const evidenceOptions = (evidence || []).map((ev) => ({ value: String(ev.id), label: ev.name || ev.title || ev.file_name || `Evidence ${ev.id}` }));

  return (
    <AccordionRow
      level={3}
      region={false}
      onOpenChange={(open) => { if (open) onOpen(); }}
      title={`${record.control_reference ?? control?.control_code ?? ''} ${record.control_title ?? ''}`.trim() || 'A requirement'}
      meta={`${record.is_applicable ? 'Asked to put it in scope' : 'Asked to put it out of scope'}${record.requested_by_name ? ` · ${record.requested_by_name}` : ''}${record.requested_at ? ` · ${formatDateTime(record.requested_at)}` : ''}`}
      trailing={<StatusPill tone={scopeDecision.tone(record.status)} label={scopeDecision.label(record.status)} />}
    >
      <div className="space-y-[12px]">
        <p className="text-ds-body text-ds-fg-body">{scopeEffect(record, inScopeNow)}</p>
        <div className="space-y-[8px]">
          <Line label="Why">{record.justification || <span className="text-ds-fg-muted">No reason was given</span>}</Line>
          {!pending && <Line label="Decided by">{record.reviewed_by_name ? `${record.reviewed_by_name}${record.reviewed_at ? ` · ${formatDateTime(record.reviewed_at)}` : ''}` : '—'}</Line>}
          {!pending && record.review_comment && <Line label="Reviewer's comment">{record.review_comment}</Line>}
        </div>

        {pending && canEdit && (
          <div className="space-y-[8px] border-t border-ds-border pt-[12px]">
            <FormField label="Comment" optional>
              <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
            </FormField>
            <div className="flex flex-wrap gap-[8px]">
              <Button variant="primary" disabled={busy} onClick={() => onDecide('approved', comment)}>Approve</Button>
              <Button variant="dangerOutline" disabled={busy} onClick={() => onDecide('rejected', comment)}>Turn down</Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-[12px] border-t border-ds-border pt-[12px] md:grid-cols-3">
          <FormField label="Owner" optional>
            {canEdit ? (
              <Select
                value={record.owner_id ?? ''}
                placeholder={record.owner_name || 'Unassigned'}
                onChange={(e) => onDetails({ owner_id: e.target.value ? Number(e.target.value) : null })}
              >
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            ) : (
              <p className="text-ds-body text-ds-fg">{record.owner_name || 'Unassigned'}</p>
            )}
          </FormField>
          <FormField label="Implementation" optional>
            {canEdit ? (
              <Select value={record.implementation_status ?? ''} placeholder={NOT_SET} onChange={(e) => onDetails({ implementation_status: e.target.value || null })}>
                {IMPLEMENTATION_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            ) : (
              <p className="text-ds-body text-ds-fg">{IMPLEMENTATION_STATUS.find((s) => s.value === record.implementation_status)?.label ?? NOT_SET}</p>
            )}
          </FormField>
          <FormField label="Linked evidence" optional hint={evidenceFailed ? "The evidence library didn't load." : undefined}>
            {canEdit ? (
              <Combobox
                label="Linked evidence"
                options={evidenceOptions}
                value={record.linked_evidence_id ? String(record.linked_evidence_id) : null}
                onChange={(v) => onDetails({ linked_evidence_id: v ? Number(v) : null })}
                placeholder={NOT_SET}
                searchPlaceholder="Search evidence"
                emptyText="No evidence in the library"
                clearable
              />
            ) : (
              <p className="text-ds-body text-ds-fg">{record.linked_evidence_id ? `Evidence ${record.linked_evidence_id}` : NOT_SET}</p>
            )}
          </FormField>
        </div>
      </div>
    </AccordionRow>
  );
}

/** A label over a sentence, full width (a FactList's columns are too narrow for a reason that runs to a few lines). */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-ds-label text-ds-fg-muted">{label}</p>
      <p className="mt-[2px] break-words text-ds-body text-ds-fg">{children}</p>
    </div>
  );
}
