'use client';

// AI governance > one call, in a Sheet: why it was made, what the data-protection check did, what reached the AI (shown only on request, to people who hold the payload
// right, and recorded in the audit log when opened), the cost, and everything in the same operation. The model that answered and the page request behind the call are
// not shown: they say nothing a person can act on.
import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Lock } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { detailText } from '@/lib/apiError';
import { statusPill } from '@/lib/status';
import { aiCall, protectionLevel } from '@/lib/statuses/adminAuditAi';
import { Button, ErrorState, Fact, FactList, Notice, Sheet, SkeletonLines, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ENTITY_LABELS, PLACEHOLDER, REASONS, fmtDuration, fmtNumber, fmtUsd, fmtWhen } from './format';
import type { CallDetail, Revealed } from './types';

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-ds-border pb-[16px] last:border-0 last:pb-0">
      <h3 className="m-0 mb-[8px] !text-ds-section !text-ds-fg">{title}</h3>
      {children}
    </section>
  );
}

const TEXT = 'whitespace-pre-wrap break-words rounded-ds-card border border-ds-border bg-ds-surface-hover p-[8px] text-[12px] leading-relaxed text-ds-fg';
function Caption({ children }: { children: React.ReactNode }) {
  return <p className="m-0 mb-[2px] text-ds-label font-[600] uppercase tracking-wide text-ds-fg-muted">{children}</p>;
}

/** Text with the guard's placeholders picked out, so it is plain what the AI saw instead of the real value. */
function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split(PLACEHOLDER).map((part, i) =>      // split with a capturing group: the odd parts are the placeholders
        i % 2 === 1
          ? <mark key={i} className="rounded-[3px] bg-ds-primary-soft px-[2px] text-ds-primary-text">{part}</mark>
          : <Fragment key={i}>{part}</Fragment>
      )}
    </>
  );
}

function PromptView({ request }: { request: string }) {
  let parsed: any = null;
  try { parsed = JSON.parse(request); } catch { /* cut off: shown as text */ }
  if (parsed && Array.isArray(parsed.messages)) {
    return (
      <div className="flex flex-col gap-[8px]">
        {parsed.messages.map((m: any, i: number) => (
          <div key={i}>
            <Caption>{m.role}</Caption>
            <div className={TEXT}><Marked text={typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2)} /></div>
          </div>
        ))}
      </div>
    );
  }
  if (parsed && (parsed.instructions || parsed.input)) {
    return (
      <div className="flex flex-col gap-[8px]">
        {parsed.instructions && <div><Caption>Instructions</Caption><div className={TEXT}><Marked text={String(parsed.instructions)} /></div></div>}
        {parsed.input && <div><Caption>Input</Caption><div className={TEXT}><Marked text={typeof parsed.input === 'string' ? parsed.input : JSON.stringify(parsed.input, null, 2)} /></div></div>}
      </div>
    );
  }
  return <div className={TEXT}><Marked text={request} /></div>;
}

export default function CallPanel({ id, onClose, onOpenUseCase }: { id: number | null; onClose: () => void; onOpenUseCase: (id: string) => void }) {
  const call = useQuery({
    queryKey: ['ai-governance-call', id],
    enabled: id != null,
    queryFn: async () => (await apiClient.get<CallDetail>(`/admin/ai-governance/activity/${id}`)).data,
  });
  const [shown, setShown] = useState<{ id: number; value: Revealed } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState('');
  const detail = call.data;
  const revealed = shown && shown.id === id ? shown.value : null;

  const reveal = async () => {
    if (id == null) return;
    setRevealing(true); setRevealError('');
    try {
      const r = await apiClient.post<Revealed>(`/admin/ai-governance/activity/${id}/reveal`);
      setShown({ id, value: r.data });
    } catch (e: any) {
      setRevealError(detailText(e?.response?.data?.detail) || 'The text could not be shown. Try again.');
    } finally {
      setRevealing(false);
    }
  };

  const g = detail?.gateway;
  const entities = Object.entries(g?.entities || {});
  return (
    <Sheet
      open={id != null}
      onClose={onClose}
      width="lg"
      title={detail ? detail.use_case_label : 'AI call'}
      subtitle={detail ? `${detail.module_label} · ${fmtWhen(detail.at)}` : undefined}
    >
      {call.isError ? (
        <ErrorState title="Couldn't open this call" message={errorMessage(call.error)} onRetry={canRetry(call.error) ? () => { void call.refetch(); } : undefined} />
      ) : !detail ? (
        <SkeletonLines lines={6} label="Loading this call" />
      ) : (
        <div className="flex flex-col gap-[16px]">
          <Block title="Why this call was made">
            {detail.use_case_detail ? (
              <>
                <p className="m-0 text-ds-body text-ds-fg">{detail.use_case_detail.value}</p>
                <p className="m-0 mt-[2px] text-ds-label text-ds-fg-muted">{detail.use_case_detail.surface}{detail.trigger ? ` · ${detail.trigger}` : ''}</p>
                <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
                  <span title={detail.use_case_detail.level_meaning}><StatusPill size="sm" {...statusPill(protectionLevel, detail.use_case_detail.level)} label={`${detail.use_case_detail.level} · ${detail.use_case_detail.level_meaning}`} /></span>
                  {detail.use_case && <Button size="sm" variant="link" onClick={() => onOpenUseCase(detail.use_case as string)}>All calls of this feature</Button>}
                </div>
              </>
            ) : <p className="m-0 text-ds-body text-ds-fg-muted">This call could not be matched to a feature in the inventory ({detail.module_label}).</p>}
            <div className="mt-[12px]">
              <FactList>
                <Fact label="Asked by">{detail.user}</Fact>
                <Fact label="Outcome"><StatusPill size="sm" {...statusPill(aiCall, detail.status)} /></Fact>
              </FactList>
            </div>
          </Block>

          <Block title="What the data-protection check did">
            {g?.blocked ? (
              <Notice tone="danger" title="Refused">{REASONS[g.blocked] || 'The request was refused before it was sent.'}</Notice>
            ) : entities.length === 0 ? (
              <p className="m-0 text-ds-body text-ds-fg-muted">{g?.decision ? 'The check found nothing that needed replacing in this request.' : 'This call was made before the data-protection check was recorded.'}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
                {entities.map(([type, n]) => {
                  const e = ENTITY_LABELS[type] || { label: type, action: 'replaced' as const };
                  return (
                    <li key={type} className="flex justify-between gap-[16px] text-ds-body">
                      <span className="text-ds-fg">{e.label}</span>
                      <span className="text-ds-fg-muted">{fmtNumber(n)} {e.action === 'removed' ? 'removed' : 'replaced by placeholders'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {g && (g.restored || g.unknown_tokens || g.invented) ? (
              <p className="m-0 mt-[8px] text-ds-label text-ds-fg-muted">
                Put back in the answer: {fmtNumber(g.restored)}{g.unknown_tokens ? ` · unknown placeholders removed: ${g.unknown_tokens}` : ''}{g.invented ? ` · made-up secrets removed: ${g.invented}` : ''}
              </p>
            ) : null}
          </Block>

          <Block title="What reached the AI">
            {!detail.payload.kept ? (
              <p className="m-0 text-ds-body text-ds-fg-muted">{detail.status === 'blocked' ? 'Nothing was sent: the request was refused.' : 'The text of this call was not kept, or has expired.'}</p>
            ) : revealed ? (
              <div className="flex flex-col gap-[12px]">
                <div>
                  <Caption>The request, exactly as it was sent{revealed.truncated ? ' (cut: too long to keep in full)' : ''}</Caption>
                  {revealed.request ? <PromptView request={revealed.request} /> : <p className="m-0 text-ds-body text-ds-fg-muted">Not kept.</p>}
                </div>
                <div>
                  <Caption>The answer, as the AI wrote it (before the original values were put back)</Caption>
                  <div className={TEXT}>{revealed.response ? <Marked text={revealed.response} /> : 'No answer was received.'}</div>
                </div>
                <p className="m-0 text-ds-label text-ds-fg-muted">Kept until {fmtWhen(revealed.expires_at)}, encrypted. Showing it is recorded in the audit log.</p>
              </div>
            ) : detail.payload.can_reveal ? (
              <div>
                <Button leftIcon={<Eye aria-hidden />} loading={revealing} onClick={() => { void reveal(); }}>Show the request and the answer</Button>
                <p className="m-0 mt-[8px] text-ds-label text-ds-fg-muted">The text is kept encrypted. Opening it is recorded in the audit log.</p>
                {revealError && <p role="alert" className="m-0 mt-[8px] text-ds-body text-ds-danger">{revealError}</p>}
              </div>
            ) : (
              <p className="m-0 flex items-center gap-[8px] text-ds-body text-ds-fg-muted"><Lock size={14} aria-hidden /> Reading the text needs the “AI governance, payloads” right.</p>
            )}
          </Block>

          <Block title="Cost">
            <FactList>
              <Fact label="Tokens sent / returned">{`${fmtNumber(detail.prompt_tokens)} / ${fmtNumber(detail.completion_tokens)}`}</Fact>
              {detail.cached_tokens > 0 ? <Fact label="Read from saved prompts">{fmtNumber(detail.cached_tokens)}</Fact> : null}
              {detail.reasoning_tokens > 0 ? <Fact label="Hidden reasoning">{fmtNumber(detail.reasoning_tokens)}</Fact> : null}
              <Fact label="Estimated cost">{fmtUsd(detail.cost_usd)}</Fact>
              <Fact label="Took">{fmtDuration(detail.duration_ms)}</Fact>
            </FactList>
          </Block>

          {detail.trace.length > 1 && (
            <Block title="Everything in the same operation">
              <ol className="m-0 flex list-none flex-col gap-[4px] p-0">
                {detail.trace.map((t) => (
                  <li key={t.id} className={`flex justify-between gap-[12px] text-ds-body ${t.id === detail.id ? 'font-[600] text-ds-fg' : 'text-ds-fg-muted'}`}>
                    <span>{fmtWhen(t.at)} · {t.use_case_label}{t.attempt > 1 ? ` (attempt ${t.attempt})` : ''}</span>
                    <span>{aiCall.label(t.status)}</span>
                  </li>
                ))}
              </ol>
            </Block>
          )}
        </div>
      )}
    </Sheet>
  );
}
