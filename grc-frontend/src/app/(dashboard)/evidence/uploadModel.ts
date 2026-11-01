// The rules of the Upload evidence form, apart from React so `node --test` can pin them (uploadModel.test.ts): which file is refused, what the name starts as, how the
// validity period is worked out, and exactly which fields the form sends. These are the rules the form always had; only the words around them changed.

/** The longest name the server stores (the column is 255 characters; a longer one used to reach the database and come back as a bare 500). */
export const NAME_MAX = 255;
/** What the file chooser offers (the server accepts more types, and a dropped file skips the chooser: see fileProblem). */
export const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg';
export const TYPES_SAID = 'PDF, DOC, DOCX, XLS, XLSX, PNG, JPG';

export const VALIDITY_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '90', label: '3 months' },
  { value: '180', label: '6 months' },
  { value: '365', label: '1 year' },
  { value: '730', label: '2 years' },
  { value: 'custom', label: 'Custom (days)' },
];
export const DEFAULT_VALIDITY = '365';

/** Why a file is not taken, or null: an executable is refused, as it always was (the server then decides about every other type). */
export function fileProblem(fileName: string): string | null {
  return fileName.split('.').pop()?.toLowerCase() === 'exe' ? 'Executable files (.exe) are not allowed.' : null;
}

/** The name a file starts with: its file name without the extension. */
export const nameFromFile = (fileName: string): string => fileName.replace(/\.[^/.]+$/, '');

/** The validity in days: a preset's number, or the custom number when it is a positive whole number; null when there is none. */
export function validityDays(preset: string, custom: string): number | null {
  if (preset === 'custom') {
    const n = parseInt(custom, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (preset === '') return null;
  const n = parseInt(preset, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The chosen assets' names, joined: the readable shorthand stored as the source system (the links themselves are the source of truth). */
export function sourceSystemLabel(linkedAssetIds: readonly number[], assets: ReadonlyArray<{ id: number; name: string }>): string {
  if (!linkedAssetIds.length) return '';
  return linkedAssetIds.map((id) => assets.find((a) => a.id === id)?.name).filter(Boolean).join(', ');
}

export interface UploadInput {
  name: string;
  description: string;
  evidenceType: string;
  /** a day, as the date field gives it (2026-11-12) */
  collectionDate: string;
  validityPreset: string;
  validityCustomDays: string;
  ownerId: number | null;
  linkedAssetIds: readonly number[];
  assets: ReadonlyArray<{ id: number; name: string }>;
  /** the custom fields to save, when there are any (the form works them out with valuesToSave) */
  custom?: Record<string, unknown> | null;
}

/** The fields of the upload, in the order the form always appended them (the file goes last): a field that is empty is not sent. The expiry date is worked out
 *  by the server from the collection date and the validity, so a validity with no collection date gives a file with no expiry (the form says so). */
export function uploadFields(input: UploadInput): Array<[string, string]> {
  const out: Array<[string, string]> = [['name', input.name]];
  if (input.description) out.push(['description', input.description]);
  if (input.evidenceType) out.push(['evidence_type', input.evidenceType]);
  if (input.collectionDate) out.push(['collection_date', input.collectionDate]);
  const days = validityDays(input.validityPreset, input.validityCustomDays);
  if (days) out.push(['validity_period_days', String(days)]);
  const source = sourceSystemLabel(input.linkedAssetIds, input.assets);
  if (source) out.push(['source_system', source]);
  if (input.ownerId) out.push(['owner_id', String(input.ownerId)]);
  if (input.custom) out.push(['custom_values', JSON.stringify(input.custom)]);
  return out;
}

/** "340 KB", "2.40 MB": a file's size as a person reads it (the form used to say "0.00 MB" for a small file). */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
