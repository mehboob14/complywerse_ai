'use client';

// One audit row, opened from the log: what happened in a sentence (the AI summary when it can be written, the plain description when not), who and when, what the request
// changed old -> new in words, and the technical details (request, result code, browser, the request body) behind a control for the people who check them (rule U1: nothing
// technical in the everyday view). The summary endpoint is unchanged: it writes the sentence once and keeps it with the row, so a row opened twice asks nothing twice.
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowRight } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { auditAction, auditChange } from '@/lib/statuses/adminAuditAi';
import { Button, Disclosure, Fact, FactList, PersonChip, Sheet, SkeletonLines, StatusPill } from '@/components/ui/ds';
import {
  cachedSummary, changeBlocks, deriveModuleContext, enrichDescription, payloadText, technicalRows, type AuditLogEntry, type DbChanges,
} from './auditModel';

const MD = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="m-0 mb-[6px] text-ds-body text-ds-fg last:mb-0">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="m-0 mb-[6px] list-disc pl-[20px] text-ds-body text-ds-fg last:mb-0">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="m-0 mb-[6px] list-decimal pl-[20px] text-ds-body text-ds-fg last:mb-0">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="text-ds-body text-ds-fg">{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-[600] text-ds-fg">{children}</strong>,
  code: ({ children }: { children?: React.ReactNode }) => <code className="rounded-ds-control bg-ds-surface-hover px-[4px] text-[12px] text-ds-fg">{children}</code>,
};

function Summary({ log }: { log: AuditLogEntry }) {
  const kept = cachedSummary(log);
  const summary = useQuery({
    queryKey: ['admin-audit-summary', log.id],
    enabled: !kept,
    queryFn: async () => (await adminApi.generateAuditLogAiSummary(log.id)).data,
    staleTime: Infinity,
    retry: false,
  });
  const text = kept || summary.data?.ai_summary || null;
  const plain = enrichDescription(log);
  return (
    <section aria-label="What happened">
      <h3 className="m-0 mb-[6px] !text-ds-section !text-ds-fg">What happened</h3>
      <div className="min-h-[44px] rounded-ds-card border border-ds-border bg-ds-primary-soft p-[12px]" aria-live="polite">
        {!kept && summary.isLoading ? (
          <SkeletonLines lines={2} label="Writing a short summary" />
        ) : text ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{text}</ReactMarkdown>
        ) : (
          <p className="m-0 text-ds-body text-ds-fg">{plain}</p>
        )}
      </div>
      {!kept && summary.isError && (
        <div className="mt-[8px] flex flex-wrap items-center gap-x-[12px] gap-y-[6px]">
          <span className="text-ds-body text-ds-fg-muted">A summary could not be written just now. The record below says the same in full.</span>
          <Button size="sm" onClick={() => { void summary.refetch(); }}>Try again</Button>
        </div>
      )}
    </section>
  );
}

function Changes({ changes }: { changes: DbChanges }) {
  const { blocks, more } = changeBlocks(changes);
  if (blocks.length === 0 && more === 0) return null;
  return (
    <section aria-label="What changed">
      <h3 className="m-0 mb-[6px] !text-ds-section !text-ds-fg">What changed</h3>
      <div className="flex flex-col gap-[8px]">
        {blocks.map((block) => (
          <div key={block.key} className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
            <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px] border-b border-ds-border px-[12px] py-[8px]">
              <StatusPill size="sm" {...statusPill(auditChange, block.op)} />
              <span className="text-ds-body font-[600] text-ds-fg">{block.kind}</span>
              {block.name && <span className="min-w-0 truncate text-ds-body text-ds-fg-body" title={block.name}>{block.name}</span>}
            </div>
            {block.lines.length > 0 ? (
              <dl className="m-0 grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] gap-x-[12px] gap-y-[6px] px-[12px] py-[8px]">
                {block.lines.map((line) => (
                  <div key={line.field} className="contents">
                    <dt className="text-ds-label font-normal text-ds-fg-muted">{line.label}</dt>
                    <dd className="m-0 min-w-0 break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">
                      {line.before ? (
                        <span className="inline-flex flex-wrap items-center gap-x-[6px]">
                          <span className="text-ds-fg-muted line-through" title={line.before.cut ? line.before.full : undefined}>{line.before.text}</span>
                          <ArrowRight aria-label="became" className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" />
                          <span title={line.after.cut ? line.after.full : undefined}>{line.after.text}</span>
                        </span>
                      ) : (
                        <span title={line.after.cut ? line.after.full : undefined}>{line.after.text}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ))}
        {more > 0 && <p className="m-0 text-ds-body text-ds-fg-muted">…and {more} more {more === 1 ? 'record' : 'records'} changed in the same request.</p>}
      </div>
    </section>
  );
}

export function AuditSheet({ log, onClose }: { log: AuditLogEntry | null; onClose: () => void }) {
  const ctx = log ? deriveModuleContext(log) : null;
  const payload = log ? payloadText(log) : null;
  const technical = log ? technicalRows(log) : [];
  return (
    <Sheet
      open={!!log}
      onClose={onClose}
      width="lg"
      title={log ? enrichDescription(log) : ''}
      subtitle={log ? `${log.user_name || 'Unknown person'} · ${formatDateTime(log.timestamp)}` : undefined}
      closeLabel="Close the record"
    >
      {log && ctx && (
        <div className="flex flex-col gap-[16px]">
          <Summary key={log.id} log={log} />
          <FactList variant="boxed">
            <Fact label="Who"><PersonChip name={log.user_name} /></Fact>
            <Fact label="When">{formatDateTime(log.timestamp)}</Fact>
            <Fact label="What was done"><StatusPill size="sm" {...statusPill(auditAction, log.action)} /></Fact>
            <Fact label="Where">{ctx.submodule ? `${ctx.module} › ${ctx.submodule}` : ctx.module}</Fact>
          </FactList>
          <Changes changes={(log.details?.db_changes ?? {}) as DbChanges} />
          {(technical.length > 0 || payload) && (
            <Disclosure label="Technical details" level={3}>
              <div className="flex flex-col gap-[12px] pt-[8px]">
                {technical.length > 0 && (
                  <FactList>
                    {technical.map(([label, value]) => <Fact key={label} label={label}>{value}</Fact>)}
                  </FactList>
                )}
                {payload && (
                  <div>
                    <p className="m-0 mb-[4px] text-ds-label text-ds-fg-muted">What was sent</p>
                    <pre className="m-0 max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-ds-card border border-ds-border bg-ds-surface-hover p-[12px] text-[12px] text-ds-fg">{payload}</pre>
                  </div>
                )}
              </div>
            </Disclosure>
          )}
        </div>
      )}
    </Sheet>
  );
}
