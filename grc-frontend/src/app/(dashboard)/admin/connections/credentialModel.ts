// What the connect forms of Administration > Connected systems decide, apart from React so `node --test` pins it (credentialModel.test.ts): the fields each kind asks for, what
// is wrong with what was typed (said in words, never with the value), and the exact payload each call is sent. The rule for credentials: they are WRITE-ONLY. A secret is typed
// into a masked field, sent once, and never read back (no endpoint returns one, and no field is ever filled with one); on a change a field left blank is NOT sent (the connectors
// server merges what it is given, so a blank would overwrite the saved value with nothing). No message built here contains a value the person typed.

// ── scanners (Rapid7 Nexpose, Tenable Nessus) ───────────────────────────────────────────────────────────────────────────────────────────

export type ScannerType = 'nexpose' | 'nessus';
export const SCANNER_PORT: Record<ScannerType, number> = { nexpose: 3780, nessus: 8834 };
export const SCANNER_EXAMPLE: Record<ScannerType, string> = { nexpose: 'https://nexpose.company.com', nessus: 'https://nessus.company.com' };

/** A schedule is a cron string for the server; the person picks a sentence. */
export const SCANNER_SCHEDULES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '0 * * * *', label: 'Every hour' },
  { value: '0 */4 * * *', label: 'Every 4 hours' },
  { value: '0 */12 * * *', label: 'Every 12 hours' },
  { value: '0 2 * * *', label: 'Every day' },
];
export const DEFAULT_SCHEDULE = '0 */4 * * *';

/** "Every 4 hours"; a schedule that is none of the four reads "Custom schedule" (it is kept as it is). */
export const scheduleLabel = (cron: string | null | undefined): string => SCANNER_SCHEDULES.find((s) => s.value === (cron ?? '').trim())?.label ?? (cron ? 'Custom schedule' : 'Not set');

export interface ScannerForm {
  type: ScannerType;
  name: string;
  url: string;
  port: string;
  /** keys: typed here and stored encrypted; server: read from the server's own settings by a name prefix (a development path) */
  mode: 'keys' | 'server';
  accessKey: string;
  secretKey: string;
  prefix: string;
  username: string;
  password: string;
  schedule: string;
}

export const emptyScanner = (type: ScannerType = 'nexpose'): ScannerForm => ({
  type, name: '', url: '', port: String(SCANNER_PORT[type]), mode: 'keys', accessKey: '', secretKey: '', prefix: '', username: '', password: '', schedule: DEFAULT_SCHEDULE,
});

const clean = (s: string): string => s.trim();
const portOf = (s: string): number => Number.parseInt(clean(s), 10);

/** What is wrong with a scanner form, field by field, in words; an empty object means it can be sent. */
export function scannerProblems(f: ScannerForm): Partial<Record<'name' | 'url' | 'port' | 'accessKey' | 'secretKey' | 'prefix', string>> {
  const out: Partial<Record<'name' | 'url' | 'port' | 'accessKey' | 'secretKey' | 'prefix', string>> = {};
  if (!clean(f.name)) out.name = 'Give the connection a name.';
  if (!clean(f.url)) out.url = 'Enter the address of the console.';
  else if (!/^https?:\/\//i.test(clean(f.url))) out.url = 'Start the address with https:// (or http://).';
  const port = portOf(f.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) out.port = 'Enter a port between 1 and 65535.';
  if (f.mode === 'keys') {
    if (!clean(f.accessKey)) out.accessKey = 'Enter the access key.';
    if (!clean(f.secretKey)) out.secretKey = 'Enter the secret key.';
  } else if (!clean(f.prefix)) out.prefix = 'Enter the name the server settings start with.';
  return out;
}

/** The body of POST /integrations/connections. A key the person did not type is left out, never sent empty. */
export function scannerPayload(f: ScannerForm): Record<string, unknown> {
  const body: Record<string, unknown> = {
    connection_name: clean(f.name),
    integration_type: f.type,
    console_url: clean(f.url),
    console_port: Number.isInteger(portOf(f.port)) ? portOf(f.port) : SCANNER_PORT[f.type],
    sync_schedule: f.schedule || DEFAULT_SCHEDULE,
  };
  if (f.mode === 'keys') { body.access_key = clean(f.accessKey); body.secret_key = clean(f.secretKey); } else body.credential_env_prefix = clean(f.prefix);
  if (clean(f.username)) body.username = clean(f.username);
  if (f.password) body.password = f.password;
  return body;
}

/** The body of PUT /integrations/connections/{id} that replaces the keys: only a key that was typed (the server keeps the other). Null when nothing was typed. */
export function scannerKeysPatch(accessKey: string, secretKey: string): Record<string, string> | null {
  const body: Record<string, string> = {};
  if (clean(accessKey)) body.access_key = clean(accessKey);
  if (clean(secretKey)) body.secret_key = clean(secretKey);
  return Object.keys(body).length ? body : null;
}

// ── cloud security (AWS Inspector, Microsoft Defender for Cloud, Google Cloud SCC) ──────────────────────────────────────────────────────

export interface CredentialField {
  key: string;
  label: string;
  /** typed into a masked box and never shown again */
  secret?: boolean;
  /** a box for a key file rather than a line */
  file?: boolean;
  placeholder?: string;
  hint?: string;
}

export const CLOUD_FIELDS: Record<string, CredentialField[]> = {
  aws_inspector: [
    { key: 'role_arn', label: 'Role to assume', placeholder: 'arn:aws:iam::123456789012:role/GRCPlatform-Inspector-Reader', hint: 'The role you created in step 5 of the guide.' },
    { key: 'external_id', label: 'External ID', hint: 'Filled in for you; it is the same every time for this organisation.' },
    { key: 'regions', label: 'Regions to scan', placeholder: 'us-east-1, eu-west-1', hint: 'Separate the regions with commas.' },
  ],
  azure_defender: [
    { key: 'tenant_id', label: 'Directory (tenant) ID', placeholder: '00000000-0000-0000-0000-000000000000' },
    { key: 'client_id', label: 'Application (client) ID', placeholder: '00000000-0000-0000-0000-000000000000' },
    { key: 'client_secret', label: 'Client secret', secret: true, hint: 'The secret value, not its ID. It is never shown again after you save.' },
    { key: 'subscription_id', label: 'Subscription ID', placeholder: '00000000-0000-0000-0000-000000000000' },
  ],
  gcp_scc: [
    { key: 'organization_id', label: 'Organisation ID', placeholder: '123456789012', hint: 'Digits only.' },
    { key: 'service_account_json', label: 'Service account key file', secret: true, file: true, hint: 'Choose the key file you downloaded, or paste its contents. It is never shown again after you save.' },
  ],
};

export const cloudFields = (provider: string): CredentialField[] => CLOUD_FIELDS[provider] ?? [];

const ROLE_ARN = /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@/_-]+$/;
const REGION = /^[a-z]{2}-[a-z]+-\d+$/;
const UUID = /^[0-9a-fA-F-]{8,40}$/;

/** A label inside a sentence: "Instance URL" -> "instance URL", "Directory (tenant) ID" -> "directory (tenant) ID"; a label that starts with an acronym ("URL of the console") keeps it. */
export const lowerFirst = (label: string): string => (/^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label);

/** "us-east-1, eu-west-1" or one per line -> ['us-east-1', 'eu-west-1'], once each. */
export function splitRegions(text: string): string[] {
  const seen: string[] = [];
  text.split(/[\s,;]+/).map((r) => r.trim().toLowerCase()).filter(Boolean).forEach((r) => { if (seen.indexOf(r) < 0) seen.push(r); });
  return seen;
}

/** The key file reads as a Google service-account key (a JSON object whose type is service_account). The file's content is never put in a message. */
export function isServiceAccountKey(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed) && typeof parsed === 'object' && (parsed as { type?: unknown }).type === 'service_account';
  } catch { return false; }
}

/** What is wrong with the credentials typed for a cloud provider, field by field, in words (never with the value). */
export function cloudProblems(provider: string, values: Record<string, string>, name: string): Record<string, string> {
  const out: Record<string, string> = {};
  const v = (k: string): string => (values[k] ?? '').trim();
  if (!name.trim()) out.name = 'Give the connection a name.';
  cloudFields(provider).forEach((f) => { if (!v(f.key)) out[f.key] = `Enter the ${lowerFirst(f.label)}.`; });
  if (provider === 'aws_inspector') {
    if (v('role_arn') && !ROLE_ARN.test(v('role_arn'))) out.role_arn = 'The role looks like arn:aws:iam::123456789012:role/Name (12-digit account).';
    if (v('regions')) {
      const bad = splitRegions(values.regions).filter((r) => !REGION.test(r));
      if (bad.length) out.regions = `${bad.length === 1 ? 'One region does' : `${bad.length} regions do`} not look like an AWS region (for example us-east-1).`;
    }
  } else if (provider === 'azure_defender') {
    ['tenant_id', 'subscription_id', 'client_id'].forEach((k) => { if (v(k) && !UUID.test(v(k))) out[k] = 'That does not look like an Azure ID (letters, digits and dashes).'; });
  } else if (provider === 'gcp_scc') {
    if (v('organization_id') && !/^\d+$/.test(v('organization_id'))) out.organization_id = 'The organisation ID is digits only.';
    if (v('service_account_json') && !isServiceAccountKey(values.service_account_json)) out.service_account_json = 'That is not a service account key file. Download the JSON key from the service account and choose it here.';
  }
  return out;
}

/** The `credentials` object the cloud-connectors server wants, built from the typed fields (it was a JSON box the person had to write). */
export function cloudCredentials(provider: string, values: Record<string, string>): Record<string, unknown> {
  const v = (k: string): string => (values[k] ?? '').trim();
  if (provider === 'aws_inspector') return { role_arn: v('role_arn'), external_id: v('external_id'), regions: splitRegions(values.regions ?? '') };
  if (provider === 'azure_defender') return { tenant_id: v('tenant_id'), client_id: v('client_id'), client_secret: v('client_secret'), subscription_id: v('subscription_id') };
  if (provider === 'gcp_scc') return { organization_id: v('organization_id'), service_account_json: v('service_account_json') };
  return {};
}

export const SYNC_HOURS = { min: 1, max: 168, fallback: 6 };
/** Hours typed -> seconds sent; a value out of range or not a number is the fallback (the old field did the same). */
export function syncSeconds(hours: string): number {
  const n = Number.parseInt(hours.trim(), 10);
  const ok = Number.isInteger(n) && n >= SYNC_HOURS.min && n <= SYNC_HOURS.max;
  return (ok ? n : SYNC_HOURS.fallback) * 3600;
}

// ── business tools ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ToolFieldMeta {
  key: string;
  label: string;
  kind: 'text' | 'password' | 'url' | 'textarea' | 'select' | 'toggle';
  required: boolean;
  placeholder?: string;
  help_text?: string;
  options?: Array<{ value: string; label: string }>;
  is_credential: boolean;
}

/** A field whose value is a secret: marked so by the server, or typed as a password. Its box is masked, never filled, and a saved value is not shown. */
export const isSecretField = (f: ToolFieldMeta): boolean => f.is_credential || f.kind === 'password';

/** Words for what is missing: a required field that is empty (on a change a saved credential counts as filled: leaving it blank keeps it). */
export function toolProblems(fields: readonly ToolFieldMeta[], values: Record<string, string>, name: string, editing: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  if (!name.trim()) out.name = 'Give the connection a name.';
  fields.forEach((f) => {
    if (!f.required || f.kind === 'toggle') return;
    if (editing && isSecretField(f)) return;
    if (!(values[f.key] ?? '').trim()) out[f.key] = `Enter the ${lowerFirst(f.label)}.`;
  });
  return out;
}

/** The `fields` the connectors server is sent. On a change a secret left blank is NOT sent (the server would overwrite the saved one with blank); everything else is sent as typed. */
export function toolFieldsToSend(fields: readonly ToolFieldMeta[], values: Record<string, string>, editing: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const known = new Set(fields.map((f) => f.key));
  fields.forEach((f) => {
    const raw = values[f.key] ?? '';
    if (f.kind === 'toggle') { if (raw === 'true' || raw === 'false') out[f.key] = raw; return; }      // sent only once the person has chosen
    if (editing && isSecretField(f) && !raw.trim()) return;
    if (!editing && !raw.trim()) return;
    out[f.key] = isSecretField(f) ? raw : raw.trim();
  });
  if (values.console_url !== undefined && !known.has('console_url') && values.console_url.trim()) out.console_url = values.console_url.trim();
  return out;
}

/** The values a change form starts from: the saved console address and settings (never a credential: the server returns none and the fields are masked and empty). */
export function toolInitialValues(fields: readonly ToolFieldMeta[], saved: { console_url?: string | null; provider_config?: Record<string, unknown> | null } | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!saved) return out;
  if (saved.console_url) out.console_url = saved.console_url;
  const secret = new Set(fields.filter(isSecretField).map((f) => f.key));
  Object.keys(saved.provider_config ?? {}).forEach((k) => {
    if (k.charAt(0) === '_' || secret.has(k)) return;
    const val = (saved.provider_config as Record<string, unknown>)[k];
    out[k] = typeof val === 'string' ? val : JSON.stringify(val);
  });
  return out;
}
