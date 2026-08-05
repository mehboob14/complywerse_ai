'use client';

import React, { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api';

// ── Generic SQL-DB credential form ────────────────────────────────────────────
// Drives the wizard's per-DB credential capture and the software set-up drawer.
// The four banking-relevant DBs (Postgres, MSSQL, MySQL, Oracle) all flow
// through the same shape — the only per-platform differences are field labels,
// default port, default database name, and (for Oracle) the TNS service-name
// vs SID twist.

export type SqlPlatformId = 'postgres' | 'mssql' | 'mysql' | 'oracle';

type SqlPlatformConfig = {
  label: string;
  runner: string;
  icon: string;
  defaultPort: number;
  // Postgres/MSSQL/MySQL all use "database name"; Oracle uses TNS service.
  dbFieldLabel: string;
  dbFieldHint: string;
  dbPlaceholder: string;
  dbDefault: string;
  // True when Oracle — we also render the optional SID field as an alt.
  isOracle?: boolean;
  userPlaceholder: string;
  hostPlaceholder: string;
  rolePrep: React.ReactNode;
  unreachableLabel: string;
};

export const SQL_DB_CONFIGS: Record<SqlPlatformId, SqlPlatformConfig> = {
  postgres: {
    label: 'PostgreSQL',
    runner: 'postgres_sql',
    icon: '🐘',
    defaultPort: 5432,
    dbFieldLabel: 'Database name',
    dbFieldHint: 'Default postgres',
    dbPlaceholder: 'postgres',
    dbDefault: 'postgres',
    userPlaceholder: 'cis_audit_ro',
    hostPlaceholder: 'pg-prod-01.bank.local',
    unreachableLabel: 'Cannot reach PostgreSQL host',
    rolePrep: (
      <>Use a <strong>read-only</strong> PostgreSQL role (e.g. <code className="font-mono">cis_audit_ro</code> with
      {' '}<code className="font-mono">pg_read_all_settings, pg_read_all_stats</code>).
      The CIS PostgreSQL Benchmark checks query <code className="font-mono">pg_settings</code>,{' '}
      <code className="font-mono">pg_hba_file_rules</code>, and similar catalogs — no writes, no DDL.</>
    ),
  },
  mssql: {
    label: 'Microsoft SQL Server',
    runner: 'mssql_sql',
    icon: '🪟',
    defaultPort: 1433,
    dbFieldLabel: 'Database name',
    dbFieldHint: 'Default master',
    dbPlaceholder: 'master',
    dbDefault: 'master',
    userPlaceholder: 'cis_audit',
    hostPlaceholder: 'sql-prod-01.bank.local',
    unreachableLabel: 'Cannot reach SQL Server',
    rolePrep: (
      <>Use a SQL login with <strong><code className="font-mono">VIEW SERVER STATE</code></strong> +
      {' '}<strong><code className="font-mono">VIEW ANY DEFINITION</code></strong> (or the
      {' '}<code className="font-mono">db_datareader</code> role on each scanned DB).
      The CIS SQL Server Benchmark checks read <code className="font-mono">sys.configurations</code>,{' '}
      <code className="font-mono">sys.server_principals</code>, audit policy, and TDE state — no
      writes. Either a SQL login or a Windows auth login backed by a service account works.</>
    ),
  },
  mysql: {
    label: 'MySQL / MariaDB',
    runner: 'mysql_sql',
    icon: '🐬',
    defaultPort: 3306,
    dbFieldLabel: 'Database name',
    dbFieldHint: 'Default information_schema',
    dbPlaceholder: 'information_schema',
    dbDefault: 'information_schema',
    userPlaceholder: 'cis_audit',
    hostPlaceholder: 'mysql-prod-01.bank.local',
    unreachableLabel: 'Cannot reach MySQL host',
    rolePrep: (
      <>Use a read-only account with <strong><code className="font-mono">PROCESS, REPLICATION CLIENT, SELECT</code></strong>{' '}
      grants on <code className="font-mono">mysql.*</code> and{' '}
      <code className="font-mono">performance_schema.*</code>. The CIS MySQL Benchmark queries
      {' '}<code className="font-mono">mysql.user</code>, <code className="font-mono">global_variables</code>,{' '}
      <code className="font-mono">audit_log_filter</code> and similar — no writes. Works against
      MariaDB too (5.x and 10.x share the catalog shape we read).</>
    ),
  },
  oracle: {
    label: 'Oracle Database',
    runner: 'oracle_sql',
    icon: '🔶',
    defaultPort: 1521,
    isOracle: true,
    dbFieldLabel: 'TNS service name',
    dbFieldHint: 'Preferred over SID',
    dbPlaceholder: 'ORCL',
    dbDefault: 'ORCL',
    userPlaceholder: 'cis_audit',
    hostPlaceholder: 'oracle-prod-01.bank.local',
    unreachableLabel: 'Cannot reach Oracle listener',
    rolePrep: (
      <>Create a read-only DB user with <code className="font-mono">SELECT_CATALOG_ROLE</code> and{' '}
      <code className="font-mono">SELECT ANY DICTIONARY</code>. The CIS Oracle Database Benchmark
      checks read from <code className="font-mono">v$parameter</code>, <code className="font-mono">dba_users</code>,
      {' '}<code className="font-mono">dba_profiles</code>, audit settings, etc. — purely read-only via
      {' '}<code className="font-mono">oracledb</code>. Service name preferred; SID supplied as an
      alternative for legacy 11g/XE installs.</>
    ),
  },
};

/** Map a detected-software key onto a SQL platform id, or null if not SQL. */
export function softwareKeyToSqlPlatform(software_key: string): SqlPlatformId | null {
  const k = (software_key || '').toLowerCase();
  if (k.startsWith('postgresql') || k.startsWith('postgres')) return 'postgres';
  if (k.startsWith('mssql') || k.startsWith('sql-server')) return 'mssql';
  if (k.startsWith('mysql') || k.startsWith('mariadb')) return 'mysql';
  if (k.startsWith('oracle')) return 'oracle';
  return null;
}

export type SqlDbCredentialsPayload = {
  hostname: string;
  display_label: string;
  port: number;
  database: string;
  oracle_sid?: string;
  username: string;
  password: string;
};

export type SqlDbFormProps = {
  platform: SqlPlatformId;
  onCancel: () => void;
  initialHostname?: string;
  initialLabel?: string;
  assetId?: number | null;
  /** Wizard mode: requires token, posts to /connect-wizard/handshake */
  token?: string;
  /** Compact styling for RightSlidePanel (less hero chrome) */
  embedded?: boolean;
  /** Override submit. When provided, form calls this instead of handshake.
   *  Receives cleaned credential fields. Throw or return rejected promise on failure
   *  with axios-like error shape `{ response: { data: { detail } } }` so existing
   *  error rendering works. */
  onSubmitCredentials?: (payload: SqlDbCredentialsPayload) => Promise<void>;
  /** Called after successful submit (wizard or custom). */
  onSuccess?: () => void;
  /** Button label override (default "Connect server" / "Validate & add to inventory") */
  submitLabel?: string;
};

export function SqlDbForm({
  platform,
  token,
  onCancel,
  initialHostname = '',
  initialLabel = '',
  assetId = null,
  embedded = false,
  onSubmitCredentials,
  onSuccess,
  submitLabel,
}: SqlDbFormProps) {
  const cfg = SQL_DB_CONFIGS[platform];
  const [label, setLabel] = useState(initialLabel);
  const [hostname, setHostname] = useState(initialHostname);
  const [port, setPort] = useState<number>(cfg.defaultPort);
  const [database, setDatabase] = useState(cfg.dbDefault);
  const [oracleSid, setOracleSid] = useState('');  // only used when platform=oracle
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Save-only: persist the login without a live connect (status 'pending').
  const [savedOnly, setSavedOnly] = useState(false);
  const [success, setSuccess] = useState(false);
  // Sync state with prop changes that arrive AFTER mount. The wizard page
  // reads URL params via useSearchParams() and propagates them down as
  // props; on the first render the URL effect hasn't fired yet so the
  // props can be empty. Without these effects, useState's lazy initial
  // captures the empty value and ignores the real one once it lands —
  // result: the operator sees placeholders instead of the prefilled
  // friendly label + hostname they expected.
  useEffect(() => {
    if (initialLabel && !label) setLabel(initialLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLabel]);
  useEffect(() => {
    if (initialHostname && !hostname) setHostname(initialHostname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHostname]);

  const defaultSubmitLabel = embedded ? 'Validate & add to inventory' : 'Connect server';
  const buttonLabel = submitLabel || defaultSubmitLabel;

  const inputCls =
    "block w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 " +
    "placeholder:text-slate-400 shadow-sm transition " +
    "focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-100";

  function renderSubmitError(e: any) {
    const d = e?.response?.data?.detail;
    if (d && typeof d === 'object' && d.preflight_failed) {
      const code = d.code || 'unknown';
      const codeLabel: Record<string, string> = {
        auth_failed: 'Authentication rejected',
        network_unreachable: cfg.unreachableLabel,
        ssl_error: 'TLS handshake failed',
        config_error: 'Configuration incomplete',
        unknown: 'Pre-flight error',
      };
      setError(`${codeLabel[code] || 'Pre-flight error'} — ${d.message}\n\nWhat to do: ${d.hint}`);
    } else if (typeof d === 'string') {
      setError(d);
    } else {
      setError(e?.message || `Failed to register ${cfg.label} connection`);
    }
  }

  async function submit(e?: React.FormEvent, saveOnly = false) {
    e?.preventDefault?.();
    setError(null);
    setSubmitting(true);
    try {
      // Trim every input — paste from DB GUIs (DBeaver, SSMS, SQL Developer)
      // routinely leaves trailing whitespace that the DB auth layer rejects.
      const cleanHost = (hostname || '').trim();
      const cleanLabel = (label || '').trim();
      const cleanDb = (database || '').trim() || cfg.dbDefault;
      const cleanSid = (oracleSid || '').trim();
      const cleanUser = (username || '').trim();
      const cleanPwd = (password || '').trim();

      // For Oracle, validate that EITHER a service name OR a SID is supplied.
      if (cfg.isOracle && !cleanDb && !cleanSid) {
        setError('Oracle needs either a TNS service name OR a SID. Both fields are empty.');
        setSubmitting(false);
        return;
      }

      const creds: SqlDbCredentialsPayload = {
        hostname: cleanHost,
        display_label: cleanLabel || cleanHost,
        port,
        database: cleanDb,
        username: cleanUser,
        password: cleanPwd,
        ...(cfg.isOracle && cleanSid ? { oracle_sid: cleanSid } : {}),
      };

      if (onSubmitCredentials) {
        await onSubmitCredentials(creds);
        setSuccess(true);
        onSuccess?.();
        return;
      }

      if (!token) {
        setError('Configuration error: SqlDbForm needs either onSubmitCredentials or a connect-wizard token.');
        return;
      }

      // The handshake endpoint reads `database_name` + `db_port` for any SQL
      // platform, and `oracle_service_name` / `oracle_sid` for Oracle in
      // particular. Backend routes by platform — extracted from `tenant_token`.
      const payload: Record<string, unknown> = {
        tenant_token: token,
        hostname: cleanHost,
        display_label: cleanLabel || cleanHost,
        os_name: `${cfg.label} · ${cleanDb || cleanSid}`,
        service_account: cleanUser,
        agent_password: cleanPwd,
        db_port: port,
        asset_id: assetId ?? undefined,
      };
      if (cfg.isOracle) {
        payload.oracle_service_name = cleanDb || undefined;
        payload.oracle_sid = cleanSid || undefined;
        // Also send database_name as the legacy alias so manual operators
        // who already use that field don't have to migrate.
        payload.database_name = cleanDb || undefined;
      } else {
        payload.database_name = cleanDb;
      }

      const endpoint = saveOnly ? '/connect-wizard/save-connection' : '/connect-wizard/handshake';
      const r = await apiClient.post(endpoint, payload);
      if (r.status >= 200 && r.status < 300) {
        if (saveOnly) setSavedOnly(true); else setSuccess(true);
        onSuccess?.();
      }
    } catch (err: any) {
      renderSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (savedOnly) {
    return (
      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-4">
        <h3 className="text-sm font-semibold text-sky-900 mb-1">Login saved</h3>
        <p className="text-sm text-sky-800">
          The {cfg.label} login for <strong className="font-medium">{hostname}</strong> is saved (encrypted) but <strong>not yet verified</strong>. Run <em>Test</em> or <em>Sync</em> from Integrations → Connections once the database is reachable.
        </p>
        <button type="button" onClick={onCancel} className="mt-3 text-sm text-primary-600 hover:underline">Done</button>
      </div>
    );
  }

  if (success) {
    const target = cfg.isOracle
      ? `${hostname}:${port}/${database || oracleSid}`
      : `${hostname}:${port}/${database}`;
    if (embedded) {
      return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4">
          <h3 className="text-sm font-semibold text-emerald-900 mb-1">{cfg.label} connected</h3>
          <p className="text-sm text-emerald-800">
            <strong className="font-medium">{target}</strong> is ready to scan.
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="mt-3 text-sm text-primary-600 hover:underline"
          >
            Done
          </button>
        </div>
      );
    }
    return (
      <div className="bg-white rounded-xl shadow-md p-8 border-2 border-emerald-300 text-center">
        <div className="text-5xl mb-3">✅</div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">{cfg.label} connected!</h2>
        <p className="text-slate-600 mb-4">
          <strong className="text-slate-900">{target}</strong> is now ready to scan.
        </p>
        <p className="text-xs text-slate-500 mb-4">
          Backend runner: <code className="font-mono">{cfg.runner}</code> · CIS {cfg.label} Benchmark plugins will execute on the next scan tick.
        </p>
        <button onClick={onCancel} className="text-sm text-primary-600 hover:underline">← Connect another</button>
      </div>
    );
  }

  const formBody = (
    <>
      {assetId && initialHostname && !embedded && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-900">
          <span className="text-base">🔗</span>
          <div>
            <span className="font-semibold">Connecting to asset #{assetId}</span> · hostname pre-filled.
          </div>
        </div>
      )}

      <p className={`text-sm text-slate-600 leading-relaxed ${embedded ? 'mb-4' : 'mb-5'}`}>{cfg.rolePrep}</p>

      <form onSubmit={submit} className="space-y-6">
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-5 h-5 rounded bg-primary-100 text-primary-700 flex items-center justify-center text-[10px] font-bold">1</span>
            Connection details
          </legend>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-slate-700">Friendly label</span>
                <span className="text-xs text-slate-400">Shown in your asset list</span>
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={`Prod ${cfg.label} · core-banking · replica`}
                required
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">Host or IP</span>
                  <span className="text-xs text-slate-400">FQDN preferred</span>
                </label>
                <input
                  type="text"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder={cfg.hostPlaceholder}
                  required
                  className={inputCls + " font-mono"}
                />
              </div>
              <div>
                <label className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">Port</span>
                  <span className="text-xs text-slate-400">Default {cfg.defaultPort}</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(Math.max(1, Math.min(65535, Number(e.target.value) || cfg.defaultPort)))}
                  className={inputCls + " font-mono"}
                />
              </div>
            </div>
            <div>
              <label className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-slate-700">{cfg.dbFieldLabel}</span>
                <span className="text-xs text-slate-400">{cfg.dbFieldHint}</span>
              </label>
              <input
                type="text"
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder={cfg.dbPlaceholder}
                required={!cfg.isOracle}
                className={inputCls + " font-mono"}
              />
              {!cfg.isOracle && (
                <p className="mt-1 text-xs text-slate-500">
                  Most CIS checks read cluster-wide catalogs and work against any database.
                  Use a real application DB only if your audit role is scoped to it.
                </p>
              )}
            </div>
            {cfg.isOracle && (
              <div>
                <label className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">SID <span className="font-normal text-slate-400">(alternative to service name)</span></span>
                  <span className="text-xs text-slate-400">Optional · legacy 11g/XE</span>
                </label>
                <input
                  type="text"
                  value={oracleSid}
                  onChange={(e) => setOracleSid(e.target.value)}
                  placeholder="XE"
                  className={inputCls + " font-mono"}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Provide either a TNS service name (above) <strong>or</strong> a SID — at least one is required.
                </p>
              </div>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
            <span className="w-5 h-5 rounded bg-primary-100 text-primary-700 flex items-center justify-center text-[10px] font-bold">2</span>
            Authentication (read-only)
          </legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-slate-700">DB user</span>
                <span className="text-xs text-slate-400">Account / login name</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={cfg.userPlaceholder}
                required
                className={inputCls + " font-mono"}
              />
            </div>
            <div>
              <label className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-slate-700">Password</span>
                <span className="text-xs text-slate-400">Stored encrypted</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={inputCls + " font-mono"}
              />
            </div>
          </div>
        </fieldset>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 whitespace-pre-line">
            {error}
          </div>
        )}

        <div className={`flex items-center ${embedded ? 'justify-end gap-3' : 'justify-between'} pt-2`}>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            {embedded ? 'Cancel' : '← Pick a different platform'}
          </button>
          <div className="flex items-center gap-3">
            {/* Save-only: persist the login without connecting. Wizard mode
                only (needs a token); hidden in the embedded collect flow. */}
            {token && !onSubmitCredentials && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => submit(undefined, true)}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? 'Saving…' : 'Save without connecting'}
              </button>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2.5 text-sm font-semibold text-[color:var(--color-on-base,#0a0a0a)] shadow-sm hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? 'Connecting…' : buttonLabel}
            </button>
          </div>
        </div>
      </form>
    </>
  );

  if (embedded) {
    return (
      <div className="overflow-hidden">
        <div className="mb-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-slate-100 flex items-center justify-center text-lg">{cfg.icon}</div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{cfg.label} credentials</h3>
            <p className="text-xs text-slate-500">Validate connection, then add to inventory</p>
          </div>
        </div>
        {formBody}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden max-w-3xl mx-auto">
      <div className="bg-slate-900 px-6 py-5 flex items-center gap-4 text-white">
        <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center text-2xl">{cfg.icon}</div>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wide text-slate-300 mb-0.5">Connect Wizard · Step 2 of 2</div>
          <h2 className="text-lg font-semibold leading-tight">{cfg.label} — Database Credentials</h2>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-emerald-500/20 text-emerald-300 rounded-full text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          End-to-end encrypted
        </div>
      </div>

      <div className="px-6 py-6">
        {formBody}
      </div>
    </div>
  );
}
