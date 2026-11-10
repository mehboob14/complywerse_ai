'use client';

// One sent questionnaire over the Sent list: who it went to, where it stands, and its answers (read when the drawer opens: the list carries none), with the actions a person may take on it. A failed
// read of the answers says so with Retry and never reads as "nothing answered". Previous and next walk the list as it is shown.
import { Copy, ExternalLink, Send } from 'lucide-react';
import Link from 'next/link';
import { Button, ErrorState, Fact, FactList, SkeletonRows, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { RecordDetail, type DetailNav } from '@/components/records/RegisterFrame';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { questionnaireStatus } from '@/lib/statuses/vendorQuestionnaires';
import {
  answerLines, answeredText, assessmentText, isLate, sentActions, strayAnswers, supplierName, templateName, type SentAction, type SentRow,
} from '../../_lib/questionnaires/sentModel';
import { useSentOne } from './sentApi';
import { questionnaireLink } from './useSentActions';

const MUTED = 'text-ds-fg-muted';

export function SentDrawer({ row, nav, can, onAct, busy }: {
  row: SentRow | null;
  nav: DetailNav;
  can: { resend: boolean; vendors: boolean };
  onAct: (action: SentAction, row: SentRow) => void;
  busy: boolean;
}) {
  const one = useSentOne(row?.id ?? null);
  const detail = one.data;
  const lines = detail ? answerLines(detail) : [];
  const stray = detail ? strayAnswers(detail) : 0;
  const actions = row ? sentActions(row, can) : [];
  const now = new Date();

  return (
    <RecordDetail
      id={row?.id ?? null}
      title={row ? supplierName(row) : ''}
      subtitle={row ? `${templateName(row)}${row.template_version_no ? ` · version ${row.template_version_no}` : ''}` : undefined}
      nav={nav}
      footer={row && (
        <div className="flex flex-wrap justify-end gap-[8px]">
          {actions.includes('copy_link') && <Button leftIcon={<Copy aria-hidden />} disabled={busy} onClick={() => onAct('copy_link', row)}>Copy link</Button>}
          {actions.includes('open_link') && detail?.token && (
            <Button href={questionnaireLink(detail.token)} target="_blank" rel="noopener noreferrer" leftIcon={<ExternalLink aria-hidden />}>Open the link</Button>
          )}
          {actions.includes('copy_contact_link') && <Button leftIcon={<Copy aria-hidden />} disabled={busy} onClick={() => onAct('copy_contact_link', row)}>Copy the contact&apos;s link</Button>}
          {actions.includes('open_assessment') && <Button href={`/vendor-risk/assessments/${row.assessment_id}`}>Open the assessment</Button>}
          {actions.includes('send_new_link') && <Button variant="primary" leftIcon={<Send aria-hidden />} disabled={busy} onClick={() => onAct('send_new_link', row)}>Send a new link</Button>}
        </div>
      )}
    >
      {row && (
        <div className="flex flex-col gap-[20px]">
          <FactList min={150}>
            <Fact label="Status"><span className="flex flex-wrap items-center gap-[6px]"><StatusPill {...statusPill(questionnaireStatus, row.status)} />{isLate(row, now) && <StatusPill tone="danger" label="Late" />}</span></Fact>
            <Fact label="Answered"><span className="tabular-nums">{answeredText(row)}</span></Fact>
            <Fact label="Due">{row.due_date ? formatDate(row.due_date) : null}</Fact>
            <Fact label="Sent">{formatDate(row.last_sent_at ?? row.created_at)}</Fact>
            <Fact label="Submitted">{row.submitted_at ? formatDate(row.submitted_at) : null}</Fact>
            <Fact label="Answered by">{row.respondent_name || row.respondent_email ? <>{row.respondent_name}{row.respondent_name && row.respondent_email ? <span className={`block text-ds-label ${MUTED}`}>{row.respondent_email}</span> : row.respondent_email}</> : null}</Fact>
            <Fact label="Supplier">{row.vendor_archived ? <span>{supplierName(row)} <span className={MUTED}>(archived)</span></span> : <Link href={`/vendor-risk/vendors/${row.vendor_id}`} className="text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{supplierName(row)}</Link>}</Fact>
            <Fact label="Assessment">{assessmentText(row)}</Fact>
          </FactList>

          <section aria-label="Answers" className="flex flex-col gap-[12px]">
            <h3 className="!text-ds-section !font-[600] !text-ds-fg">Answers</h3>
            {one.isError && !detail ? (
              <ErrorState compact title="Couldn't load the answers" message={errorMessage(one.error)} onRetry={canRetry(one.error) ? () => { void one.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
            ) : !detail ? (
              <SkeletonRows rows={4} columns={2} label="Loading the answers" />
            ) : lines.length === 0 ? (
              <p className={`text-ds-body ${MUTED}`}>This questionnaire has no questions to show.</p>
            ) : (
              <>
                {detail.attested_by && (
                  <p className="text-ds-body text-ds-fg-body">Attested by {detail.attested_by.name}{detail.attested_by.title ? `, ${detail.attested_by.title}` : ''}{detail.attested_by.at ? ` on ${formatDate(detail.attested_by.at)}` : ''}.</p>
                )}
                {lines.every((l) => !l.answered) && <p className={`text-ds-body ${MUTED}`}>Nothing has been answered yet.</p>}
                <ol className="flex flex-col divide-y divide-ds-border rounded-ds-card border border-ds-border">
                  {lines.map((l) => (
                    <li key={l.id} className="flex flex-col gap-[4px] px-[12px] py-[10px]">
                      <span className="flex gap-[8px] text-ds-body font-[600] text-ds-fg"><span className={`shrink-0 tabular-nums ${MUTED}`}>Q{l.number}</span><span className="min-w-0 break-words">{l.text}</span></span>
                      <span className={`pl-[28px] text-ds-body break-words ${l.answered ? 'text-ds-fg-body' : MUTED}`}>{l.answer}</span>
                      {l.comment && <span className={`pl-[28px] text-ds-label break-words ${MUTED}`}>Their note: {l.comment}</span>}
                    </li>
                  ))}
                </ol>
                {stray > 0 && <p className={`text-ds-label ${MUTED}`}>{stray} {stray === 1 ? 'answer belongs' : 'answers belong'} to questions that were removed from the questionnaire after it was sent.</p>}
              </>
            )}
          </section>
        </div>
      )}
    </RecordDetail>
  );
}
