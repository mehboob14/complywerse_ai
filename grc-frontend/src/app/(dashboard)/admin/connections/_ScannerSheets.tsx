'use client';

// Scanners (Rapid7 Nexpose, Tenable Nessus): connecting one, and managing one that is connected. Two sheets. The keys are typed into masked boxes, sent once and never shown again; a saved
// key reads "Saved" and is replaced, not edited. A sync runs on the server and takes minutes: the sheet polls the connection until its last sync moves past the one it started from (and
// stops after 20 minutes, saying it is still running), the way the older page did.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Pause, Play, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { Button, Checkbox, Disclosure, ErrorState, Fact, FactList, FormField, Menu, Notice, Select, Sheet, SkeletonRows, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { integrationsApi } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { scannerRows, scannerSyncSentence, syncCounters, SCANNER_LABEL, plainProblem } from './connectedModel';
import {
  SCANNER_EXAMPLE, SCANNER_PORT, SCANNER_SCHEDULES, emptyScanner, scannerKeysPatch, scannerPayload, scannerProblems, scheduleLabel, type ScannerForm, type ScannerType,
} from './credentialModel';
import { HealthPill, SheetTitle } from './_parts';
import type { ScannerFull, SyncRecord } from './_useConnected';

const SYNC_POLL_MS = 2500;
const SYNC_GIVE_UP_MS = 20 * 60 * 1000;

// ── connect ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ScannerConnectSheet({ initialType, onClose, onBack }: { initialType: ScannerType; onClose: () => void; onBack?: () => void }) {
  const [form, setForm] = useState<ScannerForm>(() => emptyScanner(initialType));
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (patch: Partial<ScannerForm>) => setForm((f) => ({ ...f, ...patch }));
  const problems = scannerProblems(form);
  const typed = Boolean(form.name || form.url || form.accessKey || form.secretKey || form.password || form.prefix || form.username);

  const create = useReportedMutation({
    mutationFn: (body: Record<string, unknown>) => integrationsApi.createConnection(body),
    success: { title: 'Scanner connected', message: 'Open it from the list and run Test to check the keys.' },
    failure: "Couldn't connect the scanner",
    invalidate: [['connections']],
    toast: 'success',
    retryable: false,
    onSuccess: onClose,
    onError: (e) => setFailure(errorMessage(e, 'The scanner was not connected.')),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    setFailure(null);
    if (Object.keys(problems).length === 0) create.mutate(scannerPayload(form));
  };
  const shown = (k: keyof typeof problems): string | undefined => (tried ? problems[k] : undefined);

  return (
    <Sheet
      open onClose={onClose} width="lg" dirty={typed && !create.isPending}
      title={<span className="inline-flex min-w-0 items-center gap-[8px]">{onBack && <Button size="sm" variant="link" leftIcon={<ArrowLeft aria-hidden />} onClick={onBack} aria-label="Back to the list of systems">Back</Button>}<span className="min-w-0 truncate">Connect a scanner</span></span>}
      subtitle="Vulnerability findings and hosts are read from the scanner on a schedule."
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="connect-scanner" loading={create.isPending}>Connect</Button>
        </>
      )}
    >
      <form id="connect-scanner" onSubmit={submit} noValidate className="flex flex-col gap-[12px]">
        {failure && <Notice tone="danger" title="The scanner was not connected">{failure}</Notice>}
        <FormField label="Scanner" required>
          <Select value={form.type} onChange={(e) => { const type = e.target.value as ScannerType; set({ type, port: form.port === String(SCANNER_PORT[form.type]) ? String(SCANNER_PORT[type]) : form.port }); }}>
            <option value="nexpose">Rapid7 Nexpose / InsightVM</option>
            <option value="nessus">Tenable Nessus</option>
          </Select>
        </FormField>
        <FormField label="Name" required error={shown('name')} hint="How it is listed here, for example Production.">
          <TextInput value={form.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" />
        </FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-[1fr_140px]">
          <FormField label="Console address" required error={shown('url')} hint={`For example ${SCANNER_EXAMPLE[form.type]}. For Tenable.io use https://cloud.tenable.com.`}>
            <TextInput type="url" value={form.url} onChange={(e) => set({ url: e.target.value })} autoComplete="off" spellCheck={false} placeholder={SCANNER_EXAMPLE[form.type]} />
          </FormField>
          <FormField label="Port" required error={shown('port')}>
            <TextInput type="number" inputMode="numeric" value={form.port} onChange={(e) => set({ port: e.target.value })} />
          </FormField>
        </div>

        {form.mode === 'keys' ? (
          <fieldset className="m-0 flex flex-col gap-[12px] rounded-ds-card border border-ds-border p-[12px]">
            <legend className="px-[4px] text-ds-label font-[600] text-ds-fg-muted">Keys</legend>
            <FormField label="Access key" required error={shown('accessKey')}>
              <TextInput type="password" value={form.accessKey} onChange={(e) => set({ accessKey: e.target.value })} autoComplete="new-password" spellCheck={false} />
            </FormField>
            <FormField label="Secret key" required error={shown('secretKey')} hint="Typed here, stored encrypted, and never shown again. For Tenable.io the keys are under Settings, My Account, API Keys.">
              <TextInput type="password" value={form.secretKey} onChange={(e) => set({ secretKey: e.target.value })} autoComplete="new-password" spellCheck={false} />
            </FormField>
            <div><Button variant="link" size="sm" onClick={() => set({ mode: 'server', accessKey: '', secretKey: '' })}>Read the keys from the server&apos;s settings instead (advanced)</Button></div>
          </fieldset>
        ) : (
          <fieldset className="m-0 flex flex-col gap-[12px] rounded-ds-card border border-ds-border p-[12px]">
            <legend className="px-[4px] text-ds-label font-[600] text-ds-fg-muted">Keys from the server&apos;s settings (advanced)</legend>
            <FormField label="Name the settings start with" required error={shown('prefix')} hint="For setting up a test system. The server reads the access key and the secret key from its own settings that start with this name, so someone with access to the server has to set them.">
              <TextInput value={form.prefix} onChange={(e) => set({ prefix: e.target.value })} autoComplete="off" spellCheck={false} />
            </FormField>
            <div><Button variant="link" size="sm" onClick={() => set({ mode: 'keys', prefix: '' })}>Type the keys here instead</Button></div>
          </fieldset>
        )}

        <Disclosure label="Sign in with a user name and password instead (optional)" level={3}>
          <div className="flex flex-col gap-[12px]">
            <FormField label="User name" optional><TextInput value={form.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" /></FormField>
            <FormField label="Password" optional hint="Use this when API keys are not available.">
              <TextInput type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" />
            </FormField>
          </div>
        </Disclosure>

        <FormField label="Read from the scanner" hint="How often hosts and findings are pulled.">
          <Select value={form.schedule} onChange={(e) => set({ schedule: e.target.value })}>
            {SCANNER_SCHEDULES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </FormField>
      </form>
    </Sheet>
  );
}

// ── manage ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Outcome = { tone: 'info' | 'danger' | 'warning'; title: string; text: string };

export function ScannerManageSheet({ conn, canEdit, canDelete, onClose }: { conn: ScannerFull; canEdit: boolean; canDelete: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const row = useMemo(() => scannerRows([conn])[0], [conn]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [syncing, setSyncing] = useState(false);
  const baseline = useRef<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['connections'] }); };

  const test = useReportedMutation({
    mutationFn: () => integrationsApi.testConnection(conn.id).then((r) => r.data as { success: boolean; message?: string }),
    failure: "Couldn't run the test",
    toast: 'errors',
    onSuccess: (d) => { setOutcome(d.success ? { tone: 'info', title: 'The connection works', text: plainProblem(d.message) ?? 'The scanner answered.' } : { tone: 'danger', title: 'The scanner did not accept the connection', text: plainProblem(d.message) ?? 'Check the address and the keys, then test again.' }); refresh(); },
  });

  const sync = useReportedMutation({
    mutationFn: () => { baseline.current = conn.last_sync_at ?? null; setOutcome(null); return integrationsApi.triggerSync(conn.id).then((r) => r.data as { status?: string } & Record<string, unknown>); },
    failure: "Couldn't start the sync",
    toast: 'errors',
    onSuccess: (d) => {
      if (d?.status === 'running') { setSyncing(true); return; }
      setOutcome({ tone: 'info', title: 'Sync finished', text: scannerSyncSentence(d) });
      refresh();
    },
  });

  // a running sync: look again until the connection's last sync is newer than the one we started from, or give up after 20 minutes and say it is still running
  useEffect(() => {
    if (!syncing) return undefined;
    const tick = setInterval(refresh, SYNC_POLL_MS);
    const giveUp = setTimeout(() => {
      setSyncing(false);
      setOutcome({ tone: 'warning', title: 'The sync is still running', text: 'A large scanner can take 10 to 20 minutes. Close this and look again later; the result is recorded when it finishes.' });
    }, SYNC_GIVE_UP_MS);
    return () => { clearInterval(tick); clearTimeout(giveUp); };
  }, [syncing]);       // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!syncing || !conn.last_sync_at || conn.last_sync_at === baseline.current) return;
    setSyncing(false);
    setOutcome(conn.last_sync_status === 'failed'
      ? { tone: 'danger', title: 'The sync failed', text: 'The scanner could not be read. Run Test for the reason.' }
      : { tone: 'info', title: 'Sync finished', text: scannerSyncSentence(conn.last_sync_stats) });
  }, [syncing, conn.last_sync_at, conn.last_sync_status, conn.last_sync_stats]);

  const pause = useReportedMutation({
    mutationFn: () => integrationsApi.deleteConnection(conn.id),
    success: { title: 'Paused', message: 'It stops syncing until you resume it. Its settings and history are kept.' },
    failure: "Couldn't pause the scanner",
    invalidate: [['connections']],
  });
  const resume = useReportedMutation({
    mutationFn: () => integrationsApi.updateConnection(conn.id, { is_active: true }),
    success: { title: 'Resumed', message: 'Run Test to check that it still connects.' },
    failure: "Couldn't resume the scanner",
    invalidate: [['connections']],
  });
  const remove = useReportedMutation({
    mutationFn: () => integrationsApi.deleteConnection(conn.id, true),
    success: 'Scanner removed',
    failure: "Couldn't remove the scanner",
    invalidate: [['connections']],
    onSuccess: onClose,
  });
  const writeback = useReportedMutation({
    mutationFn: (enabled: boolean) => integrationsApi.updateConnection(conn.id, { scanner_writeback: enabled }),
    success: (_d, enabled) => (enabled ? 'Decisions are pushed to the scanner' : 'Decisions are no longer pushed to the scanner'),
    failure: "Couldn't change the two-way sync",
    invalidate: [['connections']],
  });
  const replaceKeys = useReportedMutation({
    mutationFn: (patch: Record<string, string>) => integrationsApi.updateConnection(conn.id, patch),
    success: { title: 'Keys replaced', message: 'Run Test to check the new keys.' },
    failure: "Couldn't replace the keys",
    invalidate: [['connections']],
    onSuccess: () => { setAccessKey(''); setSecretKey(''); setReplacing(false); },
  });

  const askRemove = async () => {
    if (await confirm({ title: `Remove ${conn.connection_name}?`, message: 'The connection and its sync history are deleted and the name can be used again. Findings already synced are kept. This cannot be undone.', confirmLabel: 'Remove scanner', tone: 'danger' })) remove.mutate();
  };

  const historyQ = useQuery({
    queryKey: ['sync-history', conn.id],
    queryFn: () => integrationsApi.getSyncHistory(conn.id, { limit: 20 }).then((r) => (r.data?.records ?? []) as SyncRecord[]),
    enabled: historyOpen,
  });
  const busy = test.isPending || sync.isPending || syncing || pause.isPending || resume.isPending || remove.isPending;
  const counters = syncCounters(conn.last_sync_stats);
  const keysState = conn.has_stored_credentials ? 'Saved' : conn.credential_env_prefix ? 'Read from the server’s settings' : 'Not set';

  return (
    <Sheet
      open onClose={onClose} width="lg" dirty={Boolean(accessKey || secretKey)}
      title={<SheetTitle provider={row.provider} name={conn.connection_name} />}
      subtitle={SCANNER_LABEL[row.provider] ?? conn.integration_type}
      actions={<HealthPill health={row.health} />}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-[16px]">
        {canEdit && (
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button leftIcon={<CheckCircle2 aria-hidden />} loading={test.isPending} disabled={busy && !test.isPending} onClick={() => { setOutcome(null); test.mutate(); }}>Test</Button>
            <Button variant="primary" leftIcon={<RefreshCw aria-hidden />} loading={sync.isPending || syncing} disabled={!conn.is_active || (busy && !sync.isPending && !syncing)} onClick={() => sync.mutate()}>{syncing ? 'Syncing…' : 'Sync now'}</Button>
            {conn.is_active
              ? <Button leftIcon={<Pause aria-hidden />} loading={pause.isPending} disabled={busy && !pause.isPending} onClick={() => pause.mutate()}>Pause</Button>
              : <Button leftIcon={<Play aria-hidden />} loading={resume.isPending} disabled={busy && !resume.isPending} onClick={() => resume.mutate()}>Resume</Button>}
            <Menu label={`More actions for ${conn.connection_name}`} iconOnly items={[
              { key: 'keys', label: 'Replace the keys', onSelect: () => setReplacing(true) },
              { key: 'remove', label: 'Remove', icon: Trash2, danger: true, hidden: !canDelete, disabled: busy, onSelect: () => { void askRemove(); } },
            ]} />
          </div>
        )}

        {syncing && <Notice tone="info" title="Syncing in the background">Findings are being pulled from the scanner. This can take a few minutes; this updates by itself when it is done.</Notice>}
        {outcome && <Notice tone={outcome.tone} title={outcome.title} icon={outcome.tone === 'danger' ? XCircle : undefined}>{outcome.text}</Notice>}

        {replacing && canEdit && (
          <form className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border p-[12px]" noValidate onSubmit={(e) => { e.preventDefault(); const patch = scannerKeysPatch(accessKey, secretKey); if (patch) replaceKeys.mutate(patch); }}>
            <p className="m-0 text-ds-body font-[600] text-ds-fg">Replace the keys</p>
            <p className="m-0 text-ds-label text-ds-fg-muted">The saved keys are not shown. Type the one you are replacing, or both. A box left empty keeps what is saved.</p>
            <FormField label="Access key" optional><TextInput type="password" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} autoComplete="new-password" spellCheck={false} /></FormField>
            <FormField label="Secret key" optional><TextInput type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} autoComplete="new-password" spellCheck={false} /></FormField>
            <div className="flex flex-wrap gap-[8px]">
              <Button variant="primary" type="submit" loading={replaceKeys.isPending} disabled={!accessKey.trim() && !secretKey.trim()}>Save the keys</Button>
              <Button onClick={() => { setReplacing(false); setAccessKey(''); setSecretKey(''); }}>Cancel</Button>
            </div>
          </form>
        )}

        <FactList min={200}>
          <Fact label="Console address">{`${conn.console_url}:${conn.console_port}`}</Fact>
          <Fact label="Reads every">{scheduleLabel(conn.sync_schedule)}</Fact>
          <Fact label="Last sync">{conn.last_sync_at ? formatDateTime(conn.last_sync_at) : 'Never'}</Fact>
          <Fact label="Last result">{conn.last_sync_at ? (conn.last_sync_status === 'failed' ? 'Failed' : scannerSyncSentence(conn.last_sync_stats)) : undefined}</Fact>
          <Fact label="Keys">{keysState}</Fact>
          <Fact label="User name and password">{conn.username || conn.has_password ? `${conn.username || 'No user name'}${conn.has_password ? ', password saved' : ''}` : 'Not set'}</Fact>
          {(conn.consecutive_failures ?? 0) > 0 && <Fact label="Failed in a row">{String(conn.consecutive_failures)}</Fact>}
          <Fact label="Connected on">{formatDate(conn.created_at)}</Fact>
        </FactList>

        {canEdit && (
          <Checkbox
            checked={Boolean(conn.scanner_writeback)} disabled={writeback.isPending} onChange={(e) => writeback.mutate(e.target.checked)}
            label={(
              <span>
                <span className="font-[600] text-ds-fg">Push decisions to the scanner (two-way sync)</span>
                <span className="mt-[2px] block text-ds-label text-ds-fg-muted">When a finding is marked a false positive or given an exception here, the same decision is made in the scanner. What the scanner cannot take is recorded as skipped, with the reason. A finding that a later scan shows fixed is always closed here, without changing the scanner.</span>
              </span>
            )}
          />
        )}

        <Disclosure label="Sync history" level={3} onOpenChange={(o) => { if (o) setHistoryOpen(true); }}>
          {historyQ.isPending && historyOpen && <SkeletonRows rows={3} columns={2} label="Loading the sync history" />}
          {historyQ.isError && <ErrorState compact title="Couldn’t load the sync history" message={errorMessage(historyQ.error)} onRetry={() => { void historyQ.refetch(); }} />}
          {historyQ.data && historyQ.data.length === 0 && <p className="m-0 text-ds-body text-ds-fg-muted">No sync has run yet.</p>}
          {historyQ.data && historyQ.data.length > 0 && (
            <ul aria-label="Sync history" className="m-0 list-none p-0">
              {historyQ.data.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-[12px] border-t border-ds-border py-[6px] first:border-t-0">
                  <span className="text-ds-body text-ds-fg">{formatDateTime(h.started_at)}</span>
                  <span className="text-ds-label text-ds-fg-muted">
                    {h.duration_ms ? `${Math.max(1, Math.round(h.duration_ms / 1000))} s · ` : ''}{h.status === 'completed' ? 'Completed' : 'Failed'}
                    {` · ${h.assets_new + h.vulns_new} new, ${h.assets_updated + h.vulns_updated} updated`}{h.errors_count ? `, ${h.errors_count} ${h.errors_count === 1 ? 'error' : 'errors'}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>

        {counters.length > 0 && (
          <Disclosure label="Every counter of the last sync" level={3}>
            <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-[8px]">
              {counters.map(([name, value]) => (
                <div key={name} className="rounded-ds-control bg-ds-surface-hover px-[8px] py-[4px]">
                  <dt className="text-ds-label capitalize text-ds-fg-muted">{name}</dt>
                  <dd className="m-0 text-ds-body font-[600] text-ds-fg">{value}</dd>
                </div>
              ))}
            </dl>
          </Disclosure>
        )}
      </div>
      {confirmDialog}
    </Sheet>
  );
}
