// Words and numbers for the AI Governance page. The colours of a level and of a call outcome are the registries in lib/statuses/adminAuditAi.ts (protectionLevel, aiCall).

import { formatCount, formatDateTime } from '../../../../lib/format.ts';
import { fmtTokens as tokens, money } from '../ai-usage/usageModel.ts';

export const fmtNumber = (n: number | null | undefined) => formatCount(n ?? 0);

export const fmtTokens = tokens;

/** USD, or the plain statement that no price is set (never a made-up $0.00). */
export const fmtUsd = (n: number | null | undefined) => (n == null ? 'Price not set' : money(n, { fine: true }));

export const fmtWhen = (iso: string | null | undefined) => formatDateTime(iso, { empty: '–' });

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

/** Splits text so the placeholders the guard wrote (<PERSON_1>, <REMOVED_SECRET>) can be highlighted. */
export const PLACEHOLDER = /(<(?:[A-Z][A-Z_]*_\d+|REMOVED_[A-Z_]+)>)/;
