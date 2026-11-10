'use client';

// Settings > Emails: what third-party risk sends to suppliers and to our people, in our own words: the subject and body of each email, a preview with sample values, a test sent to yourself, and
// the way back to the built-in wording. It was the page /vendor-risk/settings/emails (which now forwards here). Each email saves on its own; the preview asks the server once the typing has
// stopped. The server escapes every value and builds only <p>, <br> and <a> from our own wording, so its preview HTML is drawn as it is.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Mail, RotateCcw, Send } from 'lucide-react';
import { Button, EmptyState, ErrorState, FormField, SectionCard, Select, SkeletonRows, TextInput, Textarea, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { vendorEmailsApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useDebounced } from '../../_lib/useDebounced';

interface Template {
  key: string; label: string; audience: string; when: string; placeholders: Record<string, string>; required: string[];
  subject: string; body: string; default_subject: string; default_body: string; changed: boolean;
  updated_at: string | null; updated_by: string | null;
}

const KEY = ['tprm-emails'] as const;

/** `onDirty` tells the page whether wording is typed and not saved: the page's leave guard asks before a link takes it away. */
export default function EmailsSection({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');      // the server's own rule for saving and resetting wording
  const [key, setKey] = useState<string | null>(null);
  const list = useQuery<{ items: Template[] }>({ queryKey: KEY, queryFn: async () => (await vendorEmailsApi.list()).data });
  const items = list.data?.items ?? [];
  const current = items.find((t) => t.key === (key || items[0]?.key));
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (current) { setSubject(current.subject); setBody(current.body); } }, [current?.key, current?.subject, current?.body]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!current && (subject !== current.subject || body !== current.body);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);

  const wording = { subject: useDebounced(subject), body: useDebounced(body) };
  const preview = useQuery({
    queryKey: ['tprm-email-preview', current?.key, wording.subject, wording.body],
    queryFn: async () => (await vendorEmailsApi.preview(current!.key, wording)).data as { subject: string; html: string },
    enabled: !!current && !!wording.subject && !!wording.body,
    retry: false,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const save = useReportedMutation({
    mutationFn: () => vendorEmailsApi.save(current!.key, { subject, body }),
    success: { title: 'Saved', message: 'It is used from the next email on.' },
    failure: 'The email could not be saved.',
    onSuccess: () => { void refresh(); },
  });
  const reset = useReportedMutation({
    mutationFn: () => vendorEmailsApi.reset(current!.key),
    success: 'Back to the built-in wording',
    failure: 'The built-in wording could not be put back.',
    onSuccess: () => { void refresh(); },
  });
  const test = useReportedMutation({
    mutationFn: async () => (await vendorEmailsApi.test(current!.key)).data as { sent_to: string },
    success: (r) => `A test was sent to ${r.sent_to}`,
    failure: 'The test email could not be sent.',
  });
  const insert = (name: string) => {
    const el = bodyRef.current;
    const token = `{${name}}`;
    if (!el) { setBody(body + token); return; }
    const at = el.selectionStart ?? body.length;
    setBody(body.slice(0, at) + token + body.slice(el.selectionEnd ?? at));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at + token.length, at + token.length); });
  };
  const pick = (next: string) => {
    if (!dirty) { setKey(next); return; }
    void confirm({ title: 'Switch email?', message: 'The wording you changed has not been saved.', confirmLabel: 'Switch and lose it', cancelLabel: 'Keep editing', tone: 'danger' }).then((ok) => { if (ok) setKey(next); });
  };

  if (list.isLoading) return <SkeletonRows rows={4} columns={2} label="Loading the emails" />;
  if (list.isError || !current) {
    return list.isError
      ? <ErrorState title="Couldn't load the emails" message={errorMessage(list.error)} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} />
      : <EmptyState kind="firstUse" bare title="No emails to edit" description="Third-party risk has no email wording on record yet." />;
  }
  const previewFailed = preview.isError ? errorMessage(preview.error, 'This wording cannot be used.') : null;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid gap-[16px] lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="lg:hidden">
            <FormField label="Email">
              <Select value={current.key} onChange={(e) => pick(e.target.value)}>
                {items.map((t) => <option key={t.key} value={t.key}>{t.label}{t.changed ? ' (changed)' : ''}</option>)}
              </Select>
            </FormField>
          </div>
          <nav className="hidden flex-col gap-[4px] lg:flex" aria-label="Emails">
            {items.map((t) => (
              <button key={t.key} type="button" onClick={() => pick(t.key)} aria-current={t.key === current.key ? 'true' : undefined}
                className={clsx('flex w-full items-start gap-[8px] rounded-ds-control px-[12px] py-[8px] text-left focus-visible:outline-none focus-visible:shadow-ds-ring',
                  t.key === current.key ? 'bg-ds-primary-soft text-ds-primary-text' : 'text-ds-fg hover:bg-ds-surface-hover')}>
                <Mail aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 opacity-60" />
                <span className="min-w-0">
                  <span className="block text-ds-body font-[600]">{t.label}</span>
                  <span className="block text-ds-label text-ds-fg-muted">To {t.audience.toLowerCase()}{t.changed ? ', in your wording' : ''}</span>
                </span>
              </button>
            ))}
          </nav>
        </div>

        <div className="grid min-w-0 gap-[16px] xl:grid-cols-2">
          <form className="flex min-w-0 flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); if (dirty && !previewFailed) save.mutate(); }}>
            <div>
              <h3 className="m-0 !text-ds-section !font-[600] !text-ds-fg">{current.label}</h3>
              <p className="text-ds-body text-ds-fg-muted">{current.when}</p>
              {current.changed && <p className="text-ds-label text-ds-fg-muted">Changed {formatDate(current.updated_at)}{current.updated_by ? ` by ${current.updated_by}` : ''}</p>}
            </div>
            <FormField label="Subject">
              <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canEdit} maxLength={200} />
            </FormField>
            <FormField label="Body" error={previewFailed}>
              <Textarea ref={bodyRef} rows={10} value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit} className="font-mono" />
            </FormField>
            <div>
              <p className="text-ds-body font-[500] text-ds-fg">Placeholders</p>
              <div className="mt-[4px] flex flex-wrap gap-[6px]">
                {Object.entries(current.placeholders).map(([name, help]) => (
                  <Button key={name} size="sm" onClick={() => insert(name)} disabled={!canEdit} title={help}>
                    <span className="font-mono">{`{${name}}`}{current.required.includes(name) ? ' *' : ''}</span>
                  </Button>
                ))}
              </div>
              {current.required.length > 0 && <p className="mt-[4px] text-ds-label text-ds-fg-muted">* must stay in the body.</p>}
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center justify-between gap-[8px]">
                <div className="flex flex-wrap gap-[8px]">
                  {current.changed && (
                    <Button leftIcon={<RotateCcw aria-hidden />} loading={reset.isPending} onClick={async () => {
                      if (await confirm({ title: 'Go back to the built-in wording?', message: `The wording of “${current.label}” you wrote is replaced by the built-in one.`, confirmLabel: 'Use the built-in wording', tone: 'danger' })) reset.mutate();
                    }}>Built-in wording</Button>
                  )}
                  <Button leftIcon={<Send aria-hidden />} loading={test.isPending} disabled={dirty} title={dirty ? 'Save first' : undefined} onClick={() => test.mutate()}>Send me a test</Button>
                </div>
                <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty || !!previewFailed}>Save this email</Button>
              </div>
            )}
          </form>

          <SectionCard id="email-preview" title="Preview" info="With sample values. Nothing is sent.">
            {preview.data ? (
              <div className="rounded-ds-control border border-ds-border bg-ds-surface">
                <p className="border-b border-ds-border px-[16px] py-[8px] text-ds-body font-[600] text-ds-fg">{preview.data.subject}</p>
                {/* The server escapes every value and builds only <p>, <br> and <a> from our own wording. */}
                <div className="flex flex-col gap-[8px] px-[16px] py-[12px] text-ds-body text-ds-fg-body [&_a]:text-ds-primary-text [&_a]:underline [&_p]:m-0 [&_p]:text-ds-body [&_p]:text-ds-fg-body"
                  dangerouslySetInnerHTML={{ __html: preview.data.html }} />
              </div>
            ) : <p className="text-ds-body text-ds-fg-muted">{preview.isFetching ? 'Preparing the preview…' : 'Fill in the subject and body to see it.'}</p>}
          </SectionCard>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
