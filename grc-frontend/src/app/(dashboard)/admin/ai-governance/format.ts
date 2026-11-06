// Words and numbers for the AI Governance page.

export const fmtNumber = (n: number | null | undefined) => new Intl.NumberFormat().format(n || 0);

export const fmtTokens = (n: number | null | undefined) => {
  const v = n || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(v);
};

/** USD, or the plain statement that no price is set (never a made-up $0.00). */
export const fmtUsd = (n: number | null | undefined) =>
  n == null ? 'Price not set' : '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: n < 0.01 && n > 0 ? 4 : 2 });

export const fmtWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–';

export const fmtDuration = (ms: number) => (ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms + ' ms');

/** Why the guard refused a call, in words a person can act on. */
export const REASONS: Record<string, string> = {
  vision_blocked: 'A picture or scanned page. Images are not sent to an outside AI; the file has to be read as text on this server.',
  restricted_data: 'This feature would send raw records, which are never sent to an outside AI.',
  stream_unsupported: 'A streamed answer cannot be checked for protected data before it is shown.',
  secret_survived: 'A secret or an account number was still in the request after the check, so nothing was sent.',
  dictionary_unavailable: "The organisation's names could not be loaded for the check, so nothing was sent.",
  unscannable_payload: 'Part of the request could not be checked, so nothing was sent.',
  gateway_error: 'The data-protection check itself failed, so nothing was sent.',
};

/** What the guard found, by type, and what it did about it. */
export const ENTITY_LABELS: Record<string, { label: string; action: 'replaced' | 'removed' }> = {
  PERSON: { label: 'People', action: 'replaced' },
  ORG: { label: 'Organisation names', action: 'replaced' },
  ORG_UNIT: { label: 'Units and teams', action: 'replaced' },
  VENDOR: { label: 'Vendors', action: 'replaced' },
  PROJECT: { label: 'Projects', action: 'replaced' },
  ASSET: { label: 'Assets', action: 'replaced' },
  HOST: { label: 'Host names', action: 'replaced' },
  EMAIL: { label: 'E-mail addresses', action: 'replaced' },
  PHONE: { label: 'Phone numbers', action: 'replaced' },
  IP_PRIV: { label: 'Internal IP addresses', action: 'replaced' },
  IP_PUB: { label: 'Public IP addresses', action: 'replaced' },
  CLOUD_ID: { label: 'Cloud identifiers', action: 'replaced' },
  SECRET: { label: 'Secrets and passwords', action: 'removed' },
  PAN: { label: 'Card numbers', action: 'removed' },
  IBAN: { label: 'Bank account numbers', action: 'removed' },
  NATIONAL_ID: { label: 'National ids', action: 'removed' },
  MAC: { label: 'MAC addresses', action: 'removed' },
};

export const LEVEL_TONE: Record<string, string> = {
  L0: 'border-emerald-300 text-emerald-800',
  L1: 'border-emerald-300 text-emerald-800',
  L2: 'border-primary-300 text-primary-800',
  L3: 'border-amber-300 text-amber-900',
  L4: 'border-rose-300 text-rose-800',
};

export const STATUS_TONE: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  failed: 'bg-amber-50 text-amber-900 border-amber-200',
  blocked: 'bg-rose-50 text-rose-800 border-rose-200',
};

export const STATUS_LABEL: Record<string, string> = { success: 'Succeeded', failed: 'Failed', blocked: 'Blocked' };

/** Splits text so the placeholders the guard wrote (<PERSON_1>, <REMOVED_SECRET>) can be highlighted. */
export const PLACEHOLDER = /(<(?:[A-Z][A-Z_]*_\d+|REMOVED_[A-Z_]+)>)/;
