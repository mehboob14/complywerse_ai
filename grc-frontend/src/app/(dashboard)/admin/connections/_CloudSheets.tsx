'use client';

// Cloud security feeds (AWS Inspector, Microsoft Defender for Cloud, Google Cloud Security Command Center): connecting one and managing one. The credentials used to be a JSON document typed
// into a visible box; they are separate fields now, the secret ones masked, and the JSON is built in code. A saved credential is never shown: replacing it means typing it again. The
// guide beside the form (what is stored, the steps, the values to paste into the cloud console) comes from the server's setup information for the provider, as before.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeft, Pause, Play, RefreshCw, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { Button, Disclosure, ErrorState, Fact, FactList, FormField, Menu, Notice, Sheet, SkeletonRows, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { cloudConnectorsApi, type CloudConnector } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { CLOUD_LABEL, cloudRows, plainProblem, scannerSyncSentence } from './connectedModel';
import { cloudCredentials, cloudFields, cloudProblems, syncSeconds, SYNC_HOURS } from './credentialModel';
import { CopyBlock, GuideBlock, HealthPill, KeyFileField, SheetTitle } from './_parts';

type Setup = Awaited<ReturnType<typeof cloudConnectorsApi.setupInfo>>['data'];

function useSetup(provider: string) {
  return useQuery({ queryKey: ['cloud-connector-setup-info', provider], queryFn: () => cloudConnectorsApi.setupInfo(provider).then((r) => r.data), enabled: Boolean(provider), staleTime: 10 * 60_000 });
}

/** What is filled in for the person: the External ID (the same every time for this organisation) and a first region. Nothing secret comes from the server. */
function prefill(setup: Setup | undefined): Record<string, string> {
  const t = (setup?.credentials_template ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  if (typeof t.external_id === 'string') out.external_id = t.external_id;
  if (Array.isArray(t.regions)) out.regions = (t.regions as unknown[]).filter((r) => typeof r === 'string').join(', ');
  return out;
}

function CredentialFields({ provider, values, setValue, errors, disabled }: { provider: string; values: Record<string, string>; setValue: (key: string, v: string) => void; errors: Record<string, string>; disabled?: boolean }) {
  return (
    <fieldset className="m-0 flex flex-col gap-[12px] rounded-ds-card border border-ds-border p-[12px]" disabled={disabled}>
      <legend className="px-[4px] text-ds-label font-[600] text-ds-fg-muted">Credentials</legend>
      {cloudFields(provider).map((f) => (
        <FormField key={f.key} label={f.label} required error={errors[f.key]} hint={f.hint}>
          {f.file ? (
            <KeyFileField value={values[f.key] ?? ''} onChange={(v) => setValue(f.key, v)} disabled={disabled} />
          ) : (
            <TextInput
              type={f.secret ? 'password' : 'text'} value={values[f.key] ?? ''} onChange={(e) => setValue(f.key, e.target.value)} placeholder={f.placeholder}
              autoComplete={f.secret ? 'new-password' : 'off'} spellCheck={false} className={f.secret ? 'font-mono' : undefined}
            />
          )}
        </FormField>
      ))}
    </fieldset>
  );
}

function Guide({ setup, loading, error, onRetry }: { setup: Setup | undefined; loading: boolean; error: unknown; onRetry: () => void }) {
  if (loading) return <SkeletonRows rows={4} columns={2} label="Loading the setup guide" />;
  if (error || !setup) return <ErrorState compact title="Couldn’t load the setup guide" message={errorMessage(error)} onRetry={onRetry} />;
  return (
    <div className="flex flex-col gap-[12px]">
      {setup.security_summary && <p className="m-0 flex gap-[8px] text-ds-body text-ds-fg-body"><ShieldCheck aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 text-ds-success" />{setup.security_summary}</p>}
      <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
        {setup.what_we_store && setup.what_we_store.length > 0 && (
          <GuideBlock title="What is stored"><ul className="m-0 list-disc pl-[18px] text-ds-label text-ds-fg-body">{setup.what_we_store.map((s) => <li key={s}>{s}</li>)}</ul></GuideBlock>
        )}
        {setup.what_we_dont_store && setup.what_we_dont_store.length > 0 && (
          <GuideBlock title="What is never stored"><ul className="m-0 list-disc pl-[18px] text-ds-label text-ds-fg-body">{setup.what_we_dont_store.map((s) => <li key={s}>{s}</li>)}</ul></GuideBlock>
        )}
      </div>
      {setup.steps && setup.steps.length > 0 && (
        <GuideBlock title="Steps">
          <ol className="m-0 flex list-none flex-col gap-[8px] p-0">
            {setup.steps.map((s, i) => (
              <li key={`${i}-${s.title}`} className="flex gap-[8px]">
                <span aria-hidden className="mt-[2px] grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full bg-ds-surface-hover text-ds-label font-[600] text-ds-fg-body">{i + 1}</span>
                <span className="min-w-0"><span className="block text-ds-body font-[600] text-ds-fg">{s.title}</span><span className="block text-ds-label text-ds-fg-body">{s.body}</span></span>
              </li>
            ))}
          </ol>
        </GuideBlock>
      )}
      {setup.copy_blocks && setup.copy_blocks.length > 0 && (
        <div className="flex flex-col gap-[8px]">
          <p className="m-0 text-ds-label font-[600] text-ds-fg-muted">Values to paste into the cloud console</p>
          {setup.copy_blocks.map((b) => <CopyBlock key={b.label} label={b.label} value={b.value} help={b.help} />)}
        </div>
      )}
    </div>
  );
}

// ── connect ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function CloudConnectSheet({ provider, label, onClose, onBack }: { provider: string; label: string; onClose: () => void; onBack?: () => void }) {
  const setupQ = useSetup(provider);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hours, setHours] = useState(String(SYNC_HOURS.fallback));
  const [values, setValues] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const setValue = (key: string, v: string) => setValues((p) => ({ ...p, [key]: v }));
  const given = useMemo(() => prefill(setupQ.data), [setupQ.data]);
  // the External ID and a first region are filled in once, for what the person has not typed
  useEffect(() => { setValues((p) => { const next = { ...p }; Object.keys(given).forEach((k) => { if (!(k in next)) next[k] = given[k]; }); return next; }); }, [given]);
  const problems = cloudProblems(provider, values, name);
  const typed = Boolean(name || description || Object.keys(values).some((k) => values[k] && values[k] !== given[k]));

  const create = useReportedMutation({
    mutationFn: () => cloudConnectorsApi.create({
      provider, display_name: name.trim(), description: description.trim() || undefined, credentials: cloudCredentials(provider, values), sync_schedule_seconds: syncSeconds(hours),
    }),
    success: { title: 'Connected', message: 'Open it from the list and run a health check to confirm the credentials work.' },
    failure: "Couldn't connect",
    invalidate: [['cloud-connectors']],
    toast: 'success',
    retryable: false,
    onSuccess: onClose,
    onError: (e) => setFailure(errorMessage(e, 'The connection was not saved.')),
  });
  const submit = (e: React.FormEvent) => { e.preventDefault(); setTried(true); setFailure(null); if (Object.keys(problems).length === 0) create.mutate(); };

  return (
    <Sheet
      open onClose={onClose} width="lg" dirty={typed && !create.isPending}
      title={<span className="inline-flex min-w-0 items-center gap-[8px]">{onBack && <Button size="sm" variant="link" leftIcon={<ArrowLeft aria-hidden />} onClick={onBack} aria-label="Back to the list of systems">Back</Button>}<span className="min-w-0 truncate">{`Connect ${label}`}</span></span>}
      subtitle="Findings and assets are read from it into the vulnerability register."
      footer={(<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="connect-cloud" loading={create.isPending}>Connect</Button></>)}
    >
      <div className="flex flex-col gap-[16px]">
        <Disclosure label="How to set this up" level={3} defaultOpen>
          <Guide setup={setupQ.data} loading={setupQ.isPending} error={setupQ.isError ? setupQ.error : null} onRetry={() => { void setupQ.refetch(); }} />
        </Disclosure>
        <form id="connect-cloud" onSubmit={submit} noValidate className="flex flex-col gap-[12px]">
          {failure && <Notice tone="danger" title="The connection was not saved">{failure}</Notice>}
          <FormField label="Name" required error={tried ? problems.name : undefined} hint="How it is listed here, for example Production AWS.">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </FormField>
          <FormField label="Description" optional><TextInput value={description} onChange={(e) => setDescription(e.target.value)} autoComplete="off" /></FormField>
          <FormField label="Read from it every" hint={`Hours, from ${SYNC_HOURS.min} to ${SYNC_HOURS.max}.`}>
            <TextInput type="number" inputMode="numeric" unit="hours" value={hours} onChange={(e) => setHours(e.target.value)} className="w-[160px]" />
          </FormField>
          <CredentialFields provider={provider} values={values} setValue={setValue} errors={tried ? problems : {}} disabled={create.isPending} />
        </form>
      </div>
    </Sheet>
  );
}

// ── manage ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Outcome = { tone: 'info' | 'danger' | 'warning'; title: string; text: string };
const HEALTH_WORD: Record<string, string> = { ok: 'The connection works', degraded: 'It answered, but not cleanly', error: 'The check failed' };

export function CloudManageSheet({ conn, onClose }: { conn: CloudConnector; onClose: () => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const row = useMemo(() => cloudRows([conn])[0], [conn]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const setupQ = useSetup(replacing ? conn.provider : '');
  const given = useMemo(() => prefill(setupQ.data), [setupQ.data]);
  useEffect(() => { setValues((p) => { const next = { ...p }; Object.keys(given).forEach((k) => { if (!(k in next)) next[k] = given[k]; }); return next; }); }, [given]);
  const problems = cloudProblems(conn.provider, values, conn.display_name);

  const health = useReportedMutation({
    mutationFn: () => cloudConnectorsApi.healthCheck(conn.id).then((r) => r.data),
    failure: "Couldn't run the health check",
    invalidate: [['cloud-connectors']],
    toast: 'errors',
    onSuccess: (d) => setOutcome({ tone: d.status === 'ok' ? 'info' : d.status === 'degraded' ? 'warning' : 'danger', title: HEALTH_WORD[d.status] ?? 'Health check done', text: plainProblem(d.detail) ?? (d.status === 'ok' ? 'The credentials are accepted.' : 'Check the credentials and the permissions, then try again.') }),
  });
  const sync = useReportedMutation({
    mutationFn: () => { setOutcome(null); return cloudConnectorsApi.sync(conn.id).then((r) => r.data); },
    failure: "Couldn't sync",
    invalidate: [['cloud-connectors']],
    toast: 'errors',
    onSuccess: (d) => setOutcome({
      tone: d.errors && d.errors.length ? 'warning' : 'info', title: d.errors && d.errors.length ? 'Synced, with errors' : 'Sync finished',
      text: `${scannerSyncSentence({ assets_new: d.assets_new, assets_updated: d.assets_updated, vulns_new: d.vulnerabilities_new, vulns_updated: d.vulnerabilities_updated, errors_count: d.errors?.length })}${d.errors && d.errors[0] ? ` ${plainProblem(d.errors[0]) ?? ''}` : ''}`,
    }),
  });
  const toggle = useReportedMutation({
    mutationFn: (active: boolean) => cloudConnectorsApi.update(conn.id, { is_active: active }),
    success: (_d, active) => (active ? { title: 'Resumed', message: 'It is read on its schedule again.' } : { title: 'Paused', message: 'It is not read until you resume it. Its settings are kept.' }),
    failure: "Couldn't change the connection",
    invalidate: [['cloud-connectors']],
  });
  const remove = useReportedMutation({
    mutationFn: () => cloudConnectorsApi.delete(conn.id),
    success: { title: 'Removed', message: 'The assets and findings it brought in are kept.' },
    failure: "Couldn't remove the connection",
    invalidate: [['cloud-connectors']],
    onSuccess: onClose,
  });
  const replace = useReportedMutation({
    mutationFn: () => cloudConnectorsApi.update(conn.id, { credentials: cloudCredentials(conn.provider, values) }),
    success: { title: 'Credentials replaced', message: 'Run a health check to confirm they work.' },
    failure: "Couldn't replace the credentials",
    invalidate: [['cloud-connectors']],
    onSuccess: () => { setValues({}); setReplacing(false); setTried(false); },
  });
  const askRemove = async () => {
    if (await confirm({ title: `Remove ${conn.display_name}?`, message: 'The connection and its saved credentials are deleted. Assets and findings it already brought in are kept. This cannot be undone.', confirmLabel: 'Remove connection', tone: 'danger' })) remove.mutate();
  };
  const busy = health.isPending || sync.isPending || toggle.isPending || remove.isPending;
  const m = (conn.health_metrics ?? {}) as Record<string, unknown>;
  const lastRun = m.last_assets_new !== undefined ? scannerSyncSentence({ assets_new: m.last_assets_new, assets_updated: m.last_assets_updated, vulns_new: m.last_vulnerabilities_new, vulns_updated: m.last_vulnerabilities_updated }) : undefined;
  const typedCredential = Object.keys(values).some((k) => values[k] && values[k] !== given[k]);

  return (
    <Sheet
      open onClose={onClose} width="lg" dirty={replacing && typedCredential}
      title={<SheetTitle provider={conn.provider} name={conn.display_name} />}
      subtitle={CLOUD_LABEL[conn.provider] ?? conn.provider}
      actions={<HealthPill health={row.health} />}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-[16px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          <Button leftIcon={<Activity aria-hidden />} loading={health.isPending} disabled={busy && !health.isPending} onClick={() => { setOutcome(null); health.mutate(); }}>Health check</Button>
          <Button variant="primary" leftIcon={<RefreshCw aria-hidden />} loading={sync.isPending} disabled={!conn.is_active || (busy && !sync.isPending)} onClick={() => sync.mutate()}>Sync now</Button>
          {conn.is_active
            ? <Button leftIcon={<Pause aria-hidden />} loading={toggle.isPending} disabled={busy && !toggle.isPending} onClick={() => toggle.mutate(false)}>Pause</Button>
            : <Button leftIcon={<Play aria-hidden />} loading={toggle.isPending} disabled={busy && !toggle.isPending} onClick={() => toggle.mutate(true)}>Resume</Button>}
          <Menu label={`More actions for ${conn.display_name}`} iconOnly items={[
            { key: 'replace', label: 'Replace the credentials', onSelect: () => setReplacing(true) },
            { key: 'remove', label: 'Remove', icon: Trash2, danger: true, disabled: busy, onSelect: () => { void askRemove(); } },
          ]} />
        </div>

        {outcome && <Notice tone={outcome.tone} title={outcome.title} icon={outcome.tone === 'danger' ? XCircle : undefined}>{outcome.text}</Notice>}
        {row.problem && !outcome && <Notice tone="danger" title="The last sync had a problem">{row.problem}</Notice>}

        {replacing && (
          <form className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border p-[12px]" noValidate onSubmit={(e) => { e.preventDefault(); setTried(true); if (Object.keys(problems).length === 0) replace.mutate(); }}>
            <p className="m-0 text-ds-body font-[600] text-ds-fg">Replace the credentials</p>
            <p className="m-0 text-ds-label text-ds-fg-muted">The saved credentials are not shown. Enter all of them again; they replace what is saved.</p>
            <CredentialFields provider={conn.provider} values={values} setValue={(k, v) => setValues((p) => ({ ...p, [k]: v }))} errors={tried ? problems : {}} disabled={replace.isPending} />
            <div className="flex flex-wrap gap-[8px]">
              <Button variant="primary" type="submit" loading={replace.isPending}>Save the credentials</Button>
              <Button onClick={() => { setReplacing(false); setValues({}); setTried(false); }}>Cancel</Button>
            </div>
          </form>
        )}

        <FactList min={200}>
          <Fact label="Reads every">{conn.sync_schedule_seconds ? `${Math.max(1, Math.round(conn.sync_schedule_seconds / 3600))} hours` : undefined}</Fact>
          <Fact label="Last sync">{conn.last_sync_at ? formatDateTime(conn.last_sync_at) : 'Never'}</Fact>
          <Fact label="Last health check">{conn.last_health_check_at ? formatDateTime(conn.last_health_check_at) : 'Never'}</Fact>
          <Fact label="Last run brought in">{lastRun}</Fact>
          <Fact label="Description">{conn.description}</Fact>
          <Fact label="Connected on">{formatDate(conn.created_at)}</Fact>
        </FactList>
      </div>
      {confirmDialog}
    </Sheet>
  );
}
