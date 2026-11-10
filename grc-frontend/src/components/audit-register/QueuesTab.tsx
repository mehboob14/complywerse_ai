'use client';

// The Queues tab: the three lists a person works through, so nobody scans 200 rows for what is waiting.
//   Validation        findings the owner submitted, waiting for Audit Services (the create right validates, in the Decision sheet)
//   Extension requests the Audit Committee has not decided, then the approved ones whose regulator still has to be told
//   Owner names        names the workbook gave that match no person: one pick each (the create right; the server's GET of the mappings asks for it too)
// Each list says how many it holds, and the tab's badge is their sum. The lists are made from the register's rows (the same read the Register tab uses) and the extension requests.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Combobox, EmptyState, ErrorState, SectionCard, SkeletonRows, WorkRow, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi } from '@/lib/api';
import { formatCount, formatDate } from '@/lib/format';
import { extensionStatus } from '@/lib/statuses/auditRegister';
import { can, type RegisterRights } from '@/lib/auditRegister/rights';
import { extensionQueue, ownersToMap, validationQueue, waitedWords, type ExtensionLine } from '@/lib/auditRegister/queuesModel';
import { dueOf, ownerName, type RegisterRow } from '@/lib/auditRegister/registerDef';
import { ExtensionDecision } from './ExtensionDecision';
import { REFRESH_ALL } from './registerData';
import { ValidationDecision } from './ValidationDecision';

type OwnerMapping = { rows: Array<{ name: string; findings: number; user_id: number | null }>; users: Array<{ id: number; name: string; email: string }> };
const titleOf = (r: { reference: string | null; title: string | null }): string => [r.reference, r.title].filter(Boolean).join(' · ') || 'Untitled finding';
const DECIDED_SHOWN = 8;

export function QueuesTab({ rows, rights, onOpen }: { rows: readonly RegisterRow[]; rights: RegisterRights; onOpen: (issueId: number) => void }) {
  const [validating, setValidating] = useState<RegisterRow | null>(null);
  const [deciding, setDeciding] = useState<ExtensionLine | null>(null);
  const [allDecided, setAllDecided] = useState(false);
  const today = useMemo(() => new Date(), [rows]);              // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = useMemo(() => validationQueue(rows, today), [rows, today]);
  const owners = useMemo(() => ownersToMap(rows), [rows]);
  const extensions = useQuery<ExtensionLine[]>({
    queryKey: ['audit-register-all-extensions'],
    queryFn: async () => (await auditRegisterApi.extensions()).data as ExtensionLine[],
  });
  const mappings = useQuery<OwnerMapping>({
    queryKey: ['audit-register-owner-mappings'], enabled: can(rights, 'readMappings'),
    queryFn: async () => (await auditRegisterApi.ownerMappings()).data as OwnerMapping,
  });
  const map = useReportedMutation({
    mutationFn: async (v: { name: string; userId: number | null }) => (await auditRegisterApi.setOwnerMapping(v.name, v.userId)).data as { findings_updated: number } & OwnerMapping,
    success: (d) => `${formatCount(d.findings_updated)} ${d.findings_updated === 1 ? 'finding' : 'findings'} reassigned`,
    failure: "Couldn't save the mapping",
    invalidate: [...REFRESH_ALL, ['audit-register-owner-mappings'], ['audit-register-reports']],
  });
  const queue = useMemo(() => extensionQueue(extensions.data ?? []), [extensions.data]);
  const sourceOf = (issueId: number): string | undefined => rows.find((r) => r.issue_id === issueId)?.source;
  const openItem = (id: number): MenuItem[] => [{ key: 'open', label: 'Open the finding', onSelect: () => onOpen(id) }];
  const people = (mappings.data?.users ?? []).map((u) => ({ value: String(u.id), label: u.name, description: u.email }));
  const decided = allDecided ? queue.decided : queue.decided.slice(0, DECIDED_SHOWN);

  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard id="queue-validation" title="Validation" meta={`${formatCount(waiting.length)} waiting for Audit Services`} info="Findings the owner submitted. The longest waiting is first. Audit Services pass and close it, or say what is missing.">
        {waiting.length === 0 ? <EmptyState bare kind="firstUse" title="Nothing is waiting for validation" /> : (
          <ul className="m-0 list-none p-0">
            {waiting.map(({ row, waitedDays }) => (
              <WorkRow
                key={row.issue_id}
                kind={{ label: 'To validate', tone: 'pending' }}
                title={titleOf(row)}
                onOpen={() => onOpen(row.issue_id)}
                context={[waitedWords(waitedDays), row.report].filter(Boolean).join(' · ')}
                requester={{ name: ownerName(row), role: 'Owner' }}
                due={dueOf(row)}
                calendar
                action={can(rights, 'decideValidation') ? { label: 'Validate', variant: 'primary', onClick: () => setValidating(row) } : undefined}
                menu={{ items: openItem(row.issue_id) }}
              />
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard id="queue-extensions" title="Extension requests" meta={extensions.data ? `${formatCount(queue.waiting.length)} waiting for the committee` : undefined} info="A new target date needs the Audit Committee’s approval. Audit Services record what the committee decided; for a regulator’s finding they also record the day the regulator was told.">
        {extensions.isLoading ? <div className="p-[12px]"><SkeletonRows rows={3} columns={3} label="Loading the extension requests" /></div>
          : extensions.isError ? <ErrorState compact title="Couldn't load the extension requests" message={errorMessage(extensions.error)} onRetry={() => { void extensions.refetch(); }} />
          : queue.waiting.length + queue.toNotify.length + queue.decided.length === 0 ? <EmptyState bare kind="firstUse" title="No extension has been asked for" description="An owner asks for more time from the finding's Extension tab." />
          : (
            <>
              <ul className="m-0 list-none p-0">
                {queue.waiting.map((x) => (
                  <WorkRow
                    key={`w${x.id}`}
                    kind={{ label: 'Extension', tone: 'pending' }}
                    title={titleOf(x)}
                    onOpen={() => onOpen(x.issue_id)}
                    context={`${formatDate(x.previous_date, { calendar: true })} → ${formatDate(x.requested_date, { calendar: true })} · ${x.reason}`}
                    requester={{ name: x.requested_by, role: 'Asked by' }}
                    due={x.meeting?.scheduled_date ?? null}
                    action={can(rights, 'decideExtension') ? { label: 'Decide', variant: 'primary', onClick: () => setDeciding(x) } : undefined}
                    menu={{ items: openItem(x.issue_id) }}
                  />
                ))}
                {queue.toNotify.map((x) => (
                  <WorkRow
                    key={`n${x.id}`}
                    kind={{ label: 'Tell the regulator', tone: 'warning' }}
                    title={titleOf(x)}
                    onOpen={() => onOpen(x.issue_id)}
                    context={`Approved: new target ${formatDate(x.requested_date, { calendar: true })}. The regulator has to be told.`}
                    requester={{ name: x.requested_by, role: 'Asked by' }}
                    action={{ label: 'Open', onClick: () => onOpen(x.issue_id) }}
                  />
                ))}
              </ul>
              {queue.decided.length > 0 && (
                <div className="border-t border-ds-border">
                  <p className="m-0 px-[12px] pt-[8px] text-ds-label font-[600] text-ds-fg-muted">Decided</p>
                  <ul className="m-0 list-none p-0">
                    {decided.map((x) => (
                      <WorkRow
                        key={`d${x.id}`}
                        kind={{ label: extensionStatus.label(x.status), tone: extensionStatus.tone(x.status) }}
                        title={titleOf(x)}
                        onOpen={() => onOpen(x.issue_id)}
                        context={`${formatDate(x.previous_date, { calendar: true })} → ${formatDate(x.requested_date, { calendar: true })}${x.decision_notes ? ` · ${x.decision_notes}` : ''}`}
                        requester={{ name: x.requested_by, role: 'Asked by' }}
                        due={x.decided_on}
                        calendar
                        overdue={false}
                      />
                    ))}
                  </ul>
                  {queue.decided.length > DECIDED_SHOWN && !allDecided && (
                    <div className="px-[12px] pb-[8px]"><Button variant="link" onClick={() => setAllDecided(true)}>Show all {formatCount(queue.decided.length)} decided</Button></div>
                  )}
                </div>
              )}
            </>
          )}
      </SectionCard>

      <SectionCard id="queue-owners" title="Owner names to map" meta={`${formatCount(owners.length)} ${owners.length === 1 ? 'name' : 'names'}`} info="Names the workbook gave that match no person. Pick who each one is: the mapping is used by every later import, and an owner set by hand on a finding is left alone.">
        {owners.length === 0 ? <EmptyState bare kind="firstUse" title="Every owner in the workbook is matched to a person" />
          : !can(rights, 'readMappings') ? <p className="m-0 p-[12px] text-ds-body text-ds-fg-body">{formatCount(owners.length)} owner {owners.length === 1 ? 'name matches' : 'names match'} nobody. Audit Services map them.</p>
          : mappings.isError ? <ErrorState compact title="Couldn't load the people" message={errorMessage(mappings.error)} onRetry={() => { void mappings.refetch(); }} />
          : (
            <ul className="m-0 list-none p-0">
              {owners.map((o) => (
                <li key={o.name} className="grid min-w-0 items-center gap-x-[12px] gap-y-[6px] border-t border-ds-border px-[12px] py-[8px] first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
                  <div className="min-w-0">
                    <p className="m-0 break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{o.name}</p>
                    <p className="m-0 text-ds-label text-ds-fg-muted">{formatCount(o.findings)} {o.findings === 1 ? 'finding' : 'findings'}</p>
                  </div>
                  <Combobox
                    label={`Who is ${o.name}`} options={people} value={null} placeholder={mappings.isLoading ? 'Loading people' : 'Choose a person'} searchPlaceholder="Search people"
                    disabled={mappings.isLoading || (map.isPending && map.variables?.name === o.name)}
                    onChange={(v) => { if (v) map.mutate({ name: o.name, userId: Number(v) }); }}
                  />
                </li>
              ))}
            </ul>
          )}
      </SectionCard>

      <ValidationDecision
        issueId={validating?.issue_id ?? 0} open={!!validating} subject={validating ? titleOf(validating) : ''} owner={validating ? ownerName(validating) : null}
        onClose={() => setValidating(null)}
      />
      <ExtensionDecision request={deciding} regulator={deciding ? sourceOf(deciding.issue_id) === 'regulator' : false} onClose={() => setDeciding(null)} />
    </div>
  );
}
