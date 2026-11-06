// What the Add / Edit vendor dialog sends. The form keeps every field as text (or a tick); this turns it into the body of
// POST /vendor-risk/vendors, or, when editing, into only what changed for PUT. Pure, so `node --test` runs vendorFormModel.test.ts.

export type VendorForm = {
  name: string; vendor_type: string; industry: string; website: string; business_unit_id: string;
  services_provided: string; tags: string;
  holds_personal_data: boolean; data_classification: string; data_location: string; systems_in_scope: string; data_types_accessed: string;
  owner_id: string; security_owner_id: string; relationship_owner_id: string;
  description: string; notes: string; status: string; data_access_level: string; tier: string; tier_justification: string;
  primary_contact_name: string; primary_contact_email: string; primary_contact_phone: string;
  contract_start_date: string; contract_end_date: string; contract_value: string;
};

// Plain text: sent trimmed when it has something in it; when editing, null once cleared.
const TEXT = [
  'vendor_type', 'industry', 'website', 'description', 'notes', 'data_location', 'data_classification',
  'primary_contact_name', 'primary_contact_email', 'primary_contact_phone', 'contract_start_date', 'contract_end_date',
] as const;
// Comma-separated names the server keeps as a list.
const LISTS = ['services_provided', 'data_types_accessed', 'systems_in_scope', 'tags'] as const;
// People and business units: a number, or none (editing: null clears it).
const IDS = ['owner_id', 'security_owner_id', 'relationship_owner_id', 'business_unit_id'] as const;

/** A new vendor's form: what the register's old add form started with (active, medium, internal data). */
export const emptyForm = (): VendorForm => ({
  name: '', vendor_type: '', industry: '', website: '', business_unit_id: '', services_provided: '', tags: '',
  holds_personal_data: false, data_classification: '', data_location: '', systems_in_scope: '', data_types_accessed: '',
  owner_id: '', security_owner_id: '', relationship_owner_id: '',
  description: '', notes: '', status: 'active', data_access_level: 'internal', tier: 'medium', tier_justification: '',
  primary_contact_name: '', primary_contact_email: '', primary_contact_phone: '',
  contract_start_date: '', contract_end_date: '', contract_value: '',
});

const text = (v: unknown): string => (v == null ? '' : String(v));
const list = (v: unknown): string => (Array.isArray(v) ? v.map(String).join(', ') : '');

/** The dialog's form for a vendor as GET /vendor-risk/vendors/{id} returns it. */
export function formFrom(v: Record<string, any>): VendorForm {
  const f = emptyForm();
  for (const key of TEXT) f[key] = text(v[key]);
  for (const key of IDS) f[key] = text(v[key]);
  for (const key of LISTS) f[key] = list(v[key]);
  f.name = text(v.name);
  f.contract_start_date = f.contract_start_date.slice(0, 10);
  f.contract_end_date = f.contract_end_date.slice(0, 10);
  f.contract_value = text(v.contract_value);
  f.holds_personal_data = v.holds_personal_data === true;
  f.status = text(v.status) || f.status;
  f.tier = text(v.tier) || f.tier;
  f.data_access_level = text(v.data_access_level) || f.data_access_level;
  return f;
}

/** "a, b ,,a" -> ["a", "b"]: trimmed, none empty, each once. */
export const splitList = (value: string): string[] => Array.from(new Set(value.split(',').map((s) => s.trim()).filter(Boolean)));

const amount = (value: string): number | null => (value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);

/** The body of POST /vendor-risk/vendors. Blank text is left out (the server holds nothing), lists are always sent. */
export function createBody(f: VendorForm): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: f.name.trim(), tier: f.tier, status: f.status || 'active', data_access_level: f.data_access_level,
    holds_personal_data: f.holds_personal_data,
  };
  for (const key of TEXT) if (f[key].trim()) body[key] = f[key].trim();
  for (const key of LISTS) body[key] = splitList(f[key]);
  for (const key of IDS) if (f[key]) body[key] = Number(f[key]);
  const value = amount(f.contract_value);
  if (value != null) body.contract_value = value;
  return body;
}

/** The body of PUT /vendor-risk/vendors/{id}: only what differs from `was` (the form as it opened), a cleared field as null. */
export function updateBody(f: VendorForm, was: VendorForm): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (f.name.trim() !== was.name.trim()) body.name = f.name.trim();
  for (const key of TEXT) if (f[key].trim() !== was[key].trim()) body[key] = f[key].trim() || null;
  for (const key of LISTS) {
    const now = splitList(f[key]);
    if (JSON.stringify(now) !== JSON.stringify(splitList(was[key]))) body[key] = now;
  }
  for (const key of IDS) if (f[key] !== was[key]) body[key] = f[key] ? Number(f[key]) : null;
  if (f.contract_value.trim() !== was.contract_value.trim()) body.contract_value = amount(f.contract_value);
  if (f.holds_personal_data !== was.holds_personal_data) body.holds_personal_data = f.holds_personal_data;
  if (f.status && f.status !== was.status) body.status = f.status;
  if (f.data_access_level && f.data_access_level !== was.data_access_level) body.data_access_level = f.data_access_level;
  if (f.tier !== was.tier) {
    body.tier = f.tier;
    if (f.tier_justification.trim()) body.tier_justification = f.tier_justification.trim();
  }
  return body;
}

export const WHY_MIN = 10;

/** What stops a save, in words: the server refuses these too, but not before the person has waited for it. `was` is the form as it
 *  opened (null: a new vendor); `tiered` says a tier was worked out, so changing it is an override that has to be explained. */
export function problems(f: VendorForm, was: VendorForm | null, tiered: boolean): string[] {
  const out: string[] = [];
  if (!f.name.trim()) out.push('Give the vendor a name.');
  if (was && tiered && f.tier !== was.tier && f.tier_justification.trim().length < WHY_MIN) out.push(`Say why the tier changes (at least ${WHY_MIN} characters).`);
  if (f.contract_start_date && f.contract_end_date && f.contract_end_date < f.contract_start_date) out.push('The contract ends before it starts.');
  if (f.contract_value.trim() !== '' && amount(f.contract_value) == null) out.push('The contract value is not a number.');
  return out;
}
