// The Shared tab (the Vendor Exchange: "complete once, reuse"), apart from React (`sharedModel.test.ts`): the rows the server answers, what a row offers, what an import needs, and the picker of suppliers
// both sheets use. The server's rules are tpra/exchange.py and tpra/api.py: only an active shared assessment can be imported from by token, and only a supplier with an active assessment can be published.
import { formatDate } from '../../../../../lib/format.ts';
import { sharedRating, sharedStatus } from '../../../../../lib/statuses/vendorQuestionnaires.ts';

export interface SharedRow {
  id: number;
  vendor_id: number | null;
  vendor_name: string | null;
  template_name: string | null;
  residual_rating: string | null;
  response_count: number;
  evidence_count: number;
  share_token: string;
  status: string;
  validated_at: string | null;
  expires_at: string | null;
}

/** One supplier of `GET /vendor-risk/vendor-options`. */
export interface VendorOption {
  id: number;
  name: string;
  status: string | null;
  tier: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  active_assessment_id: number | null;
}
export interface VendorOptions { items: VendorOption[]; total: number; skip: number; limit: number }

export const isActive = (r: Pick<SharedRow, 'status'>): boolean => r.status === 'active';
export const supplierText = (r: Pick<SharedRow, 'vendor_name'>): string => r.vendor_name || 'A supplier that is no longer listed';
export const ratingWord = (r: Pick<SharedRow, 'residual_rating'>): string => ((r.residual_rating || '').toLowerCase() in { critical: 1, high: 1, medium: 1, low: 1 } ? (r.residual_rating as string).toLowerCase() : 'unscored');
export const ratingLabel = (r: Pick<SharedRow, 'residual_rating'>): string => sharedRating.label(ratingWord(r));

/** "5 shared · 2 revoked": what the exchange holds. */
export function sharedHead(rows: readonly SharedRow[]): string {
  const live = rows.filter(isActive).length;
  const bits = [`${live.toLocaleString('en-GB')} shared`];
  if (rows.length - live > 0) bits.push(`${(rows.length - live).toLocaleString('en-GB')} revoked`);
  return bits.join(' · ');
}

/** A short line for a row's drawer or card: what is in it and until when. */
export function contentsText(r: Pick<SharedRow, 'response_count' | 'evidence_count' | 'expires_at'>): string {
  const a = `${r.response_count.toLocaleString('en-GB')} ${r.response_count === 1 ? 'answer' : 'answers'}`;
  const e = `${r.evidence_count.toLocaleString('en-GB')} ${r.evidence_count === 1 ? 'document' : 'documents'}`;
  return r.expires_at ? `${a} · ${e} · shared until ${formatDate(r.expires_at)}` : `${a} · ${e}`;
}

export type SharedAction = 'copy_token' | 'download' | 'revoke';

/** Copying the token and downloading the package are reads (any signed-in person, as before); revoking is a write (`assessments:edit`) and only on a shared assessment that is still active. */
export function sharedActions(r: Pick<SharedRow, 'status'>, can: { edit: boolean }): SharedAction[] {
  const out: SharedAction[] = ['copy_token', 'download'];
  if (can.edit && isActive(r)) out.push('revoke');
  return out;
}

/** The file name of a downloaded package: the supplier's name, words and dashes, never an id. */
export function packageFileName(r: Pick<SharedRow, 'vendor_name'>): string {
  const slug = (r.vendor_name || 'supplier').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'supplier';
  return `shared-assessment-${slug}.json`;
}

export type ImportInput = { target: number | null; token: string; pasted: string };
export type ImportPlan = { ok: true; body: { share_token?: string; package?: Record<string, unknown> } } | { ok: false; problem: string };

/** What an import sends, or what is missing, in the words the sheet shows: a token wins over a pasted package (as before), a package must be readable JSON. */
export function importPlan(input: ImportInput): ImportPlan {
  if (input.target == null) return { ok: false, problem: 'Choose the supplier whose assessment the answers go into.' };
  if (input.token.trim()) return { ok: true, body: { share_token: input.token.trim() } };
  if (!input.pasted.trim()) return { ok: false, problem: 'Paste a share token, or a package that was downloaded from another organisation.' };
  try {
    const parsed = JSON.parse(input.pasted);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, problem: 'That is not a package. Paste the whole file that was downloaded.' };
    return { ok: true, body: { package: parsed as Record<string, unknown> } };
  } catch {
    return { ok: false, problem: 'That text is not a readable package. Paste the whole file that was downloaded.' };
  }
}

// ── the supplier picker ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The options of a Combobox: the name, with the primary contact under it when there is one (what the Send sheet used to show). A supplier that cannot be picked here (nothing to publish from) is shown, disabled, with the reason. */
export function vendorChoices(items: readonly VendorOption[], { needAssessment = false }: { needAssessment?: boolean } = {}): Array<{ value: string; label: string; description?: string; disabled?: boolean }> {
  return items.map((v) => {
    const noAssessment = needAssessment && v.active_assessment_id == null;
    const contact = v.primary_contact_email || v.primary_contact_name || undefined;
    return { value: String(v.id), label: v.name, ...(noAssessment ? { description: 'No active assessment yet', disabled: true } : contact ? { description: contact } : {}) };
  });
}

/** When the picker holds fewer suppliers than the organisation has, it says so (up to 5,000 are read at once). */
export const pickerNote = (total: number, shown: number): string | null =>
  total > shown ? `Only the first ${shown.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} suppliers are listed here.` : null;

export const statusLabel = (r: Pick<SharedRow, 'status'>): string => sharedStatus.label(r.status);
