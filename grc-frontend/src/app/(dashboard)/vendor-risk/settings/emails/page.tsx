'use client';

// The emails third-party risk sends, in our own words: change the subject and
// body, see it filled in before saving, send it to yourself, or go back to the
// built-in wording.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, Loader2, Mail, RotateCcw, Send } from 'lucide-react';
import { vendorEmailsApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { fmtDate } from '../../_lib/tprmShared';
import { errText } from '../../_lib/intake/types';

interface Template {
  key: string; label: string; audience: string; when: string; placeholders: Record<string, string>; required: string[];
  subject: string; body: string; default_subject: string; default_body: string; changed: boolean;
  updated_at: string | null; updated_by: string | null;
}

export default function EmailsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  const [key, setKey] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery<{ items: Template[] }>({
    queryKey: ['tprm-emails'],
    queryFn: async () => (await vendorEmailsApi.list()).data,
  });
  const current = data?.items.find((t) => t.key === (key || data.items[0]?.key));
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (current) { setSubject(current.subject); setBody(current.body); } }, [current?.key, current?.subject, current?.body]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!current && (subject !== current.subject || body !== current.body);
  const { data: preview, error: previewError } = useQuery({
    queryKey: ['tprm-email-preview', current?.key, subject, body],
    queryFn: async () => (await vendorEmailsApi.preview(current!.key, { subject, body })).data as { subject: string; html: string },
    enabled: !!current && !!subject && !!body,
    retry: false,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tprm-emails'] });
  const save = useMutation({
    mutationFn: () => vendorEmailsApi.save(current!.key, { subject, body }),
    onSuccess: () => { refresh(); toast({ type: 'success', title: 'Saved', message: 'It is used from the next email on.' }); },
    onError: (e) => toast({ type: 'error', title: 'Not saved', message: errText(e, 'Try again.') }),
  });
  const reset = useMutation({
    mutationFn: () => vendorEmailsApi.reset(current!.key),
    onSuccess: () => { refresh(); toast({ type: 'success', title: 'Back to the built-in wording' }); },
  });
  const test = useMutation({
    mutationFn: async () => (await vendorEmailsApi.test(current!.key)).data as { sent_to: string },
    onSuccess: (r) => toast({ type: 'success', title: `Test sent to ${r.sent_to}` }),
    onError: (e) => toast({ type: 'error', title: 'Test not sent', message: errText(e, 'Try again.') }),
  });
  const insert = (name: string) => {
    const el = bodyRef.current;
    const token = `{${name}}`;
    if (!el) return setBody(body + token);
    const at = el.selectionStart ?? body.length;
    setBody(body.slice(0, at) + token + body.slice(el.selectionEnd ?? at));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at + token.length, at + token.length); });
  };

  return (
    <div className="space-y-5">
      <Link href="/vendor-risk/settings" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"><ArrowLeft className="h-3.5 w-3.5" /> Settings</Link>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Emails</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
          What third-party risk sends to suppliers and to our people, in our own words. Placeholders in braces are filled in
          when each email goes out.
        </p>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : isError || !data || !current ? (
        <p className="text-sm text-rose-700">Could not load the emails.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
          <nav className="space-y-1" aria-label="Emails">
            {data.items.map((t) => (
              <button key={t.key} type="button" onClick={() => setKey(t.key)} aria-current={t.key === current.key ? 'page' : undefined}
                className={clsx('flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm',
                  t.key === current.key ? 'bg-primary-50 text-primary-800' : 'text-slate-700 hover:bg-slate-50')}>
                <Mail className="mt-0.5 h-4 w-4 shrink-0 opacity-60" />
                <span><span className="block font-medium">{t.label}</span>
                  <span className="text-xs text-slate-500">To: {t.audience.toLowerCase()}{t.changed ? ' · changed' : ''}</span></span>
              </button>
            ))}
          </nav>

          <div className="grid gap-5 xl:grid-cols-2">
            <form className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{current.label}</h2>
                <p className="text-xs text-slate-500">{current.when}</p>
                {current.changed && <p className="mt-0.5 text-[11px] text-slate-400">Changed {fmtDate(current.updated_at)}{current.updated_by ? ` by ${current.updated_by}` : ''}</p>}
              </div>
              <label className="block text-xs font-medium text-slate-700">Subject
                <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canEdit} maxLength={200}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
              </label>
              <label className="block text-xs font-medium text-slate-700">Body
                <textarea ref={bodyRef} rows={10} value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-[13px] focus:border-primary-500 focus:outline-none" />
              </label>
              <div>
                <p className="text-xs font-medium text-slate-700">Placeholders</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {Object.entries(current.placeholders).map(([name, help]) => (
                    <button key={name} type="button" onClick={() => insert(name)} disabled={!canEdit} title={help}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-700 hover:bg-slate-100">
                      {`{${name}}`}{current.required.includes(name) ? ' *' : ''}
                    </button>
                  ))}
                </div>
                {current.required.length > 0 && <p className="mt-1 text-[11px] text-slate-400">* must stay in the body.</p>}
              </div>
              {previewError && <p className="text-xs text-rose-700">{errText(previewError, 'This wording cannot be used.')}</p>}
              {canEdit && (
                <div className="flex flex-wrap justify-between gap-2 pt-1">
                  <div className="flex gap-2">
                    {current.changed && (
                      <button type="button" onClick={() => { if (window.confirm('Go back to the built-in wording?')) reset.mutate(); }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                        <RotateCcw className="h-3.5 w-3.5" /> Built-in wording
                      </button>
                    )}
                    <button type="button" onClick={() => test.mutate()} disabled={test.isPending || dirty} title={dirty ? 'Save first' : undefined}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      <Send className="h-3.5 w-3.5" /> Send me a test
                    </button>
                  </div>
                  <button type="submit" disabled={!dirty || save.isPending || !!previewError}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                    {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
                  </button>
                </div>
              )}
            </form>

            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4" aria-labelledby="email-preview">
              <h2 id="email-preview" className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Preview, with sample values</h2>
              {preview ? (
                <div className="mt-2 rounded-lg border border-slate-200 bg-white">
                  <p className="border-b border-slate-100 px-4 py-2 text-sm font-medium text-slate-900">{preview.subject}</p>
                  {/* The server escapes every value and builds only <p>, <br> and <a> from our own wording. */}
                  <div className="space-y-2 px-4 py-3 text-sm text-slate-700 [&_a]:text-primary-700 [&_a]:underline" dangerouslySetInnerHTML={{ __html: preview.html }} />
                </div>
              ) : <p className="mt-2 text-sm text-slate-500">Fill in the subject and body to see it.</p>}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
