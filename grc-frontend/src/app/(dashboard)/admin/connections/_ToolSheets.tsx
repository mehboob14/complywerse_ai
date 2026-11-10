'use client';

// Business tools (ServiceNow, Splunk, Teams, ratings and discovery services …): connecting one, changing one, and managing one that is connected. The fields of each tool come from the
// server's catalogue of providers (kind, required, which are credentials), so a new provider needs no change here. A credential is typed into a masked box, never shown again, and on a
// change a box left empty keeps what is saved (it is not sent: the server would overwrite the saved value with nothing).
import { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ExternalLink, Pause, Play, RefreshCw, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { Button, Checkbox, Fact, FactList, FormField, Menu, Notice, Select, Sheet, TextInput, Textarea, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { connectorsApi, type ConnectorProviderMeta, type ConnectorRow } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { plainProblem, toolGroupLabel, toolRows } from './connectedModel';
import { isSecretField, toolFieldsToSend, toolInitialValues, toolProblems, type ToolFieldMeta } from './credentialModel';
import { HealthPill, SheetTitle } from './_parts';

const asFields = (meta: ConnectorProviderMeta): ToolFieldMeta[] => meta.fields as unknown as ToolFieldMeta[];

function ToolField({ f, value, onChange, editing, error }: { f: ToolFieldMeta; value: string; onChange: (v: string) => void; editing: boolean; error?: string }) {
  const secret = isSecretField(f);
  const hint = [f.help_text, secret && editing ? 'Saved. Leave empty to keep it.' : secret ? 'Stored encrypted. Never shown again.' : ''].filter(Boolean).join(' ');
  if (f.kind === 'toggle') {
    return <Checkbox label={f.label} checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} />;
  }
  return (
    <FormField label={f.label} required={f.required && !(editing && secret)} optional={!f.required || (editing && secret)} error={error} hint={hint || undefined}>
      {f.kind === 'textarea' ? (
        <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} autoComplete="off" spellCheck={false} className={secret ? 'font-mono [-webkit-text-security:disc]' : 'font-mono'} />
      ) : f.kind === 'select' ? (
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      ) : (
        <TextInput
          type={secret ? 'password' : f.kind === 'url' ? 'url' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder}
          autoComplete={secret ? 'new-password' : 'off'} spellCheck={false}
        />
      )}
    </FormField>
  );
}

// ── connect / change ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ToolSheet({ meta, existing, onClose, onBack }: { meta: ConnectorProviderMeta; existing: ConnectorRow | null; onClose: () => void; onBack?: () => void }) {
  const editing = Boolean(existing);
  const fields = useMemo(() => asFields(meta), [meta]);
  const initial = useMemo(() => toolInitialValues(fields, existing), [fields, existing]);
  const [name, setName] = useState(existing?.connection_name ?? `${meta.label} (primary)`);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const problems = toolProblems(fields, values, name, editing);
  const typed = name !== (existing?.connection_name ?? `${meta.label} (primary)`) || Object.keys(values).some((k) => (values[k] ?? '') !== (initial[k] ?? ''));

  const save = useReportedMutation({
    mutationFn: async () => {
      const sent = toolFieldsToSend(fields, values, editing);
      if (existing) return { kind: 'update' as const, saved: (await connectorsApi.update(existing.id, { connection_name: name.trim(), console_url: sent.console_url, fields: sent })).data.connection };
      const r = await connectorsApi.create({ provider: meta.provider, connection_name: name.trim(), console_url: sent.console_url, fields: sent });
      return { kind: 'create' as const, saved: r.data.connection, test: r.data.test_result };
    },
    success: (d) => (d.kind === 'update'
      ? 'Settings saved'
      : d.test?.success ? { title: 'Connected', message: plainProblem(d.test.message) ?? 'The connection test passed.' } : { title: 'Saved, but the test failed', message: plainProblem(d.test?.message) ?? 'Check the settings, then run Test from its sheet.' }),
    failure: editing ? "Couldn't save the settings" : "Couldn't connect",
    invalidate: [['connectors', 'list']],
    toast: 'success',
    retryable: false,
    onSuccess: (d) => {
      onClose();
      // an OAuth tool is not usable until the person has agreed in the tool's own window: open it right after the first save, as before
      if (d.kind === 'create' && meta.auth_method === 'oauth2' && d.saved.id) {
        connectorsApi.oauthStart(meta.provider, d.saved.id).then((r) => { window.open(r.data.authorize_url, '_blank', 'noopener,width=720,height=820'); }).catch(() => undefined);
      }
    },
    onError: (e) => setFailure(errorMessage(e, 'The settings were not saved.')),
  });
  const submit = (e: React.FormEvent) => { e.preventDefault(); setTried(true); setFailure(null); if (Object.keys(problems).length === 0) save.mutate(); };

  return (
    <Sheet
      open onClose={onClose} width="lg" dirty={typed && !save.isPending}
      title={<span className="inline-flex min-w-0 items-center gap-[8px]">{onBack && !editing && <Button size="sm" variant="link" leftIcon={<ArrowLeft aria-hidden />} onClick={onBack} aria-label="Back to the list of systems">Back</Button>}<span className="min-w-0 truncate">{editing ? `Settings of ${existing?.connection_name}` : `Connect ${meta.label}`}</span></span>}
      subtitle={meta.description}
      footer={(<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="connect-tool" loading={save.isPending}>{editing ? 'Save' : 'Connect'}</Button></>)}
    >
      <form id="connect-tool" onSubmit={submit} noValidate className="flex flex-col gap-[12px]">
        {failure && <Notice tone="danger" title={editing ? 'The settings were not saved' : 'The connection was not saved'}>{failure}</Notice>}
        {meta.beta && <Notice tone="warning" title="Beta">This connection is new. Check what it does in a test system first.</Notice>}
        <FormField label="Name" required error={tried ? problems.name : undefined} hint="How it is listed here. You can connect the same tool more than once, for example for test and production.">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </FormField>
        {fields.map((f) => (
          <ToolField key={f.key} f={f} value={values[f.key] ?? ''} onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))} editing={editing} error={tried ? problems[f.key] : undefined} />
        ))}
        {meta.auth_method === 'oauth2' && !editing && (
          <Notice tone="info" icon={ShieldCheck} title="You agree in the tool&apos;s own window">After you connect, the sign-in page of {meta.label} opens. Agree there once; the access it gives is stored encrypted and used for the ongoing sync.</Notice>
        )}
        {meta.docs_url && (
          <a href={meta.docs_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-ds-control items-center gap-[4px] text-ds-label text-ds-fg-muted hover:text-ds-primary-text">{`${meta.label} documentation`}<ExternalLink aria-hidden className="h-[12px] w-[12px]" /></a>
        )}
      </form>
    </Sheet>
  );
}

// ── manage ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Outcome = { tone: 'info' | 'danger'; title: string; text: string };

export function ToolManageSheet({ conn, meta, onEdit, onClose }: { conn: ConnectorRow; meta: ConnectorProviderMeta | undefined; onEdit: () => void; onClose: () => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const row = useMemo(() => toolRows([conn])[0], [conn]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const test = useReportedMutation({
    mutationFn: () => connectorsApi.test(conn.id).then((r) => r.data),
    failure: "Couldn't run the test",
    invalidate: [['connectors', 'list']],
    toast: 'errors',
    onSuccess: (d) => setOutcome(d.success ? { tone: 'info', title: 'The connection works', text: plainProblem(d.message) ?? 'The tool answered.' } : { tone: 'danger', title: 'The tool did not accept the connection', text: plainProblem(d.message) ?? 'Check the settings, then test again.' }),
  });
  const sync = useReportedMutation({
    mutationFn: () => connectorsApi.sync(conn.id),
    success: { title: 'Sync started', message: 'It runs in the background; the last result here updates when it finishes.' },
    failure: "Couldn't start the sync",
    invalidate: [['connectors', 'list']],
  });
  const toggle = useReportedMutation({
    mutationFn: (active: boolean) => connectorsApi.update(conn.id, { is_active: active }),
    success: (_d, active) => (active ? { title: 'Resumed', message: 'It works again.' } : { title: 'Paused', message: 'Nothing is sent or read until you resume it. Its settings are kept.' }),
    failure: "Couldn't change the connection",
    invalidate: [['connectors', 'list']],
  });
  const authorise = useReportedMutation({
    mutationFn: () => connectorsApi.oauthStart(conn.provider, conn.id).then((r) => r.data),
    failure: "Couldn't open the sign-in page",
    toast: 'errors',
    onSuccess: (d) => { window.open(d.authorize_url, '_blank', 'noopener,width=720,height=820'); },
  });
  const remove = useReportedMutation({
    mutationFn: () => connectorsApi.remove(conn.id),
    success: 'Connection removed',
    failure: "Couldn't remove the connection",
    invalidate: [['connectors', 'list']],
    onSuccess: onClose,
  });
  const askRemove = async () => {
    if (await confirm({ title: `Remove ${conn.connection_name}?`, message: 'The connection and its saved credentials are deleted. This cannot be undone.', confirmLabel: 'Remove connection', tone: 'danger' })) remove.mutate();
  };
  const busy = test.isPending || sync.isPending || toggle.isPending || remove.isPending;

  return (
    <Sheet
      open onClose={onClose} width="lg"
      title={<SheetTitle provider={conn.provider} name={conn.connection_name} />}
      subtitle={conn.provider_label || conn.provider}
      actions={<HealthPill health={row.health} />}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-[16px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          <Button leftIcon={<CheckCircle2 aria-hidden />} loading={test.isPending} disabled={busy && !test.isPending} onClick={() => { setOutcome(null); test.mutate(); }}>Test</Button>
          <Button variant="primary" leftIcon={<RefreshCw aria-hidden />} loading={sync.isPending} disabled={!conn.is_active || (busy && !sync.isPending)} onClick={() => sync.mutate()}>Sync now</Button>
          {conn.is_active
            ? <Button leftIcon={<Pause aria-hidden />} loading={toggle.isPending} disabled={busy && !toggle.isPending} onClick={() => toggle.mutate(false)}>Pause</Button>
            : <Button leftIcon={<Play aria-hidden />} loading={toggle.isPending} disabled={busy && !toggle.isPending} onClick={() => toggle.mutate(true)}>Resume</Button>}
          <Button disabled={!meta || busy} onClick={onEdit}>Change settings</Button>
          <Menu label={`More actions for ${conn.connection_name}`} iconOnly items={[
            { key: 'authorise', label: 'Sign in to the tool again', hidden: conn.auth_method !== 'oauth2', disabled: authorise.isPending, onSelect: () => authorise.mutate() },
            { key: 'remove', label: 'Remove', icon: Trash2, danger: true, disabled: busy, onSelect: () => { void askRemove(); } },
          ]} />
        </div>
        {outcome && <Notice tone={outcome.tone} title={outcome.title} icon={outcome.tone === 'danger' ? XCircle : undefined}>{outcome.text}</Notice>}

        <FactList min={200}>
          <Fact label="Kind of tool">{toolGroupLabel(conn.category)}</Fact>
          <Fact label="Address">{conn.console_url}</Fact>
          <Fact label="Last sync">{conn.last_sync_at ? formatDateTime(conn.last_sync_at) : 'Never'}</Fact>
          <Fact label="Last result">{conn.last_sync_status ? (conn.last_sync_status === 'success' ? 'Worked' : conn.last_sync_status === 'partial' ? 'Partly worked' : 'Failed') : undefined}</Fact>
          <Fact label="Credentials">{conn.has_credentials ? 'Saved' : 'Not set'}</Fact>
          {(conn.consecutive_failures ?? 0) > 0 && <Fact label="Failed in a row">{String(conn.consecutive_failures)}</Fact>}
          <Fact label="Connected on">{formatDate(conn.created_at)}</Fact>
        </FactList>
      </div>
      {confirmDialog}
    </Sheet>
  );
}
