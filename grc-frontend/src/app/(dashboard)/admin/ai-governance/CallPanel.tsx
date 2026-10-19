'use client';

import { detailText } from '@/lib/apiError';
import { Fragment, useEffect, useState } from 'react';
import { Eye, Lock } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import { apiClient } from '@/lib/api';
import { ENTITY_LABELS, LEVEL_TONE, PLACEHOLDER, REASONS, STATUS_LABEL, STATUS_TONE, fmtDuration, fmtNumber, fmtUsd, fmtWhen } from './format';
import type { CallDetail, Revealed } from './types';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-slate-100 pb-4 last:border-0">
      <h3 className="mb-2 text-sm font-semibold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

function Pair({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-0.5 text-sm">
      <dt className="text-slate-700">{k}</dt>
      <dd className="text-right text-slate-900">{v}</dd>
    </div>
  );
}

/** Text with the guard's placeholders picked out, so it is plain what the model saw instead of the real value. */
function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split(PLACEHOLDER).map((part, i) =>      // split with a capturing group: the odd parts are the placeholders
        i % 2 === 1
          ? <mark key={i} className="rounded bg-primary-100 px-0.5 text-primary-900">{part}</mark>
          : <Fragment key={i}>{part}</Fragment>
      )}
    </>
  );
}

function PromptView({ request }: { request: string }) {
  let parsed: any = null;
  try { parsed = JSON.parse(request); } catch { /* cut off: shown as text */ }
  const block = 'whitespace-pre-wrap break-words rounded border border-slate-200 p-2 text-xs leading-relaxed text-slate-900';
  if (parsed && Array.isArray(parsed.messages)) {
    return (
      <div className="space-y-2">
        {parsed.messages.map((m: any, i: number) => (
          <div key={i}>
            <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-slate-700">{m.role}</div>
            <div className={block}><Marked text={typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2)} /></div>
          </div>
        ))}
      </div>
    );
  }
  if (parsed && (parsed.instructions || parsed.input)) {
    return (
      <div className="space-y-2">
        {parsed.instructions && <><div className="text-xs font-medium uppercase tracking-wide text-slate-700">Instructions</div><div className={block}><Marked text={String(parsed.instructions)} /></div></>}
        {parsed.input && <><div className="text-xs font-medium uppercase tracking-wide text-slate-700">Input</div><div className={block}><Marked text={typeof parsed.input === 'string' ? parsed.input : JSON.stringify(parsed.input, null, 2)} /></div></>}
      </div>
    );
  }
  return <div className={block}><Marked text={request} /></div>;
}

export default function CallPanel({ id, onClose, onOpenUseCase }: { id: number | null; onClose: () => void; onOpenUseCase: (id: string) => void }) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [error, setError] = useState('');
  const [shown, setShown] = useState<Revealed | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState('');

  useEffect(() => {
    setDetail(null); setShown(null); setError(''); setRevealError('');
    if (id == null) return;
    let live = true;
    apiClient.get<CallDetail>(`/admin/ai-governance/activity/${id}`)
      .then((r) => { if (live) setDetail(r.data); })
      .catch((e) => { if (live) setError(detailText(e?.response?.data?.detail) || 'Could not load this call.'); });
    return () => { live = false; };
  }, [id]);

  const reveal = async () => {
    if (id == null) return;
    setRevealing(true); setRevealError('');
    try {
      const r = await apiClient.post<Revealed>(`/admin/ai-governance/activity/${id}/reveal`);
      setShown(r.data);
    } catch (e: any) {
      setRevealError(detailText(e?.response?.data?.detail) || 'Could not show the text.');
    } finally {
      setRevealing(false);
    }
  };

  const g = detail?.gateway;
  const entities = Object.entries(g?.entities || {});
  return (
    <RightSlidePanel
      isOpen={id != null}
      onClose={onClose}
      title={detail ? detail.use_case_label : 'AI call'}
      subtitle={detail ? `${detail.module_label} · ${fmtWhen(detail.at)}` : undefined}
      width="w-full max-w-2xl"
    >
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {!detail && !error && <p className="text-sm text-slate-700">Loading…</p>}
      {detail && (
        <div className="space-y-4">
          <Section title="Why this call was made">
            {detail.use_case_detail ? (
              <>
                <p className="text-sm text-slate-900">{detail.use_case_detail.value}</p>
                <p className="mt-1 text-xs text-slate-700">{detail.use_case_detail.surface}{detail.trigger ? ` · ${detail.trigger}` : ''}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span title={detail.use_case_detail.level_meaning} className={`rounded-full border px-2 py-0.5 text-xs font-medium ${LEVEL_TONE[detail.use_case_detail.level]}`}>
                    {detail.use_case_detail.level} · {detail.use_case_detail.level_meaning}
                  </span>
                  {detail.use_case && (
                    <button type="button" onClick={() => onOpenUseCase(detail.use_case as string)} className="text-xs font-medium text-primary-700 hover:underline">All calls of this feature</button>
                  )}
                </div>
              </>
            ) : <p className="text-sm text-slate-700">This call could not be matched to a feature in the inventory ({detail.module}).</p>}
            <dl className="mt-3">
              <Pair k="Asked by" v={detail.user} />
              {detail.endpoint && <Pair k="Page request" v={<code className="text-xs">{detail.http_method} {detail.endpoint}</code>} />}
              <Pair k="Outcome" v={<span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[detail.status] || STATUS_TONE.failed}`}>{STATUS_LABEL[detail.status] || detail.status}</span>} />
              {detail.error_type && detail.status !== 'blocked' && <Pair k="Error" v={detail.error_type} />}
            </dl>
          </Section>

          <Section title="What the data-protection check did">
            {g?.blocked ? (
              <p className="rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-900">
                Refused{g.rule ? ` (rule ${g.rule})` : ''}: {REASONS[g.blocked] || 'the request was refused before it was sent.'}
              </p>
            ) : entities.length === 0 ? (
              <p className="text-sm text-slate-700">{g?.decision ? 'The check found nothing that needed replacing in this request.' : 'This call was made before the data-protection check was recorded.'}</p>
            ) : (
              <ul className="space-y-0.5 text-sm">
                {entities.map(([type, n]) => {
                  const e = ENTITY_LABELS[type] || { label: type, action: 'replaced' as const };
                  return (
                    <li key={type} className="flex justify-between gap-4">
                      <span>{e.label}</span>
                      <span className="text-slate-700">{fmtNumber(n)} {e.action === 'removed' ? 'removed' : 'replaced by placeholders'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {g && (g.restored || g.unknown_tokens || g.invented) ? (
              <p className="mt-2 text-xs text-slate-700">
                Put back in the answer: {fmtNumber(g.restored)}{g.unknown_tokens ? ` · unknown placeholders removed: ${g.unknown_tokens}` : ''}{g.invented ? ` · made-up secrets removed: ${g.invented}` : ''}
              </p>
            ) : null}
          </Section>

          <Section title="What reached the AI">
            {!detail.payload.kept ? (
              <p className="text-sm text-slate-700">
                {detail.status === 'blocked' ? 'Nothing was sent: the request was refused.' : 'The text of this call was not kept, or has expired.'}
              </p>
            ) : shown ? (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-700">The request, exactly as it was sent {shown.truncated ? '(cut: too long to keep in full)' : ''}</div>
                  {shown.request ? <PromptView request={shown.request} /> : <p className="text-sm text-slate-700">Not kept.</p>}
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-700">The answer, as the AI wrote it (before the original values were put back)</div>
                  <div className="whitespace-pre-wrap break-words rounded border border-slate-200 p-2 text-xs leading-relaxed text-slate-900">
                    {shown.response ? <Marked text={shown.response} /> : 'No answer was received.'}
                  </div>
                </div>
                <p className="text-xs text-slate-700">Kept until {fmtWhen(shown.expires_at)}, encrypted. Showing it is recorded in the audit log.</p>
              </div>
            ) : detail.payload.can_reveal ? (
              <div>
                <button type="button" onClick={reveal} disabled={revealing} className="inline-flex items-center gap-2 rounded-md border border-primary-500 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-800 hover:bg-primary-100 disabled:opacity-50">
                  <Eye size={15} aria-hidden /> {revealing ? 'Opening…' : 'Show the request and the answer'}
                </button>
                <p className="mt-2 text-xs text-slate-700">The text is kept encrypted. Opening it is recorded in the audit log.</p>
                {revealError && <p role="alert" className="mt-2 text-sm text-rose-700">{revealError}</p>}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-slate-700"><Lock size={14} aria-hidden /> Reading the text needs the “AI Governance → payloads” permission.</p>
            )}
          </Section>

          <Section title="Cost">
            <dl>
              <Pair k="Model asked for" v={detail.requested_model || '–'} />
              {detail.response_model && detail.response_model !== detail.requested_model && <Pair k="Model that answered" v={detail.response_model} />}
              <Pair k="Tokens in / out" v={`${fmtNumber(detail.prompt_tokens)} / ${fmtNumber(detail.completion_tokens)}`} />
              {detail.cached_tokens > 0 && <Pair k="Cached input tokens" v={fmtNumber(detail.cached_tokens)} />}
              {detail.reasoning_tokens > 0 && <Pair k="Reasoning tokens" v={fmtNumber(detail.reasoning_tokens)} />}
              <Pair k="Estimated cost" v={fmtUsd(detail.cost_usd)} />
              <Pair k="Duration" v={fmtDuration(detail.duration_ms)} />
            </dl>
          </Section>

          {detail.trace.length > 1 && (
            <Section title="Everything in the same operation">
              <ol className="space-y-1 text-sm">
                {detail.trace.map((t) => (
                  <li key={t.id} className={`flex justify-between gap-3 ${t.id === detail.id ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                    <span>{fmtWhen(t.at)} · {t.use_case_label}{t.attempt > 1 ? ` (attempt ${t.attempt})` : ''}</span>
                    <span>{STATUS_LABEL[t.status] || t.status}</span>
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>
      )}
    </RightSlidePanel>
  );
}
