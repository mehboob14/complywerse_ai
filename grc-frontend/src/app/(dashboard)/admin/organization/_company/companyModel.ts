// The Company stage of Administration > Organisation: what the page asks, checks and sends, as decisions apart from React so `node --test` can pin them.
// The company's name and primary contact are the organisation's own columns (GET/PUT /admin/organization); the other company facts (legal entity, industry, size,
// geography, regulatory scope) are asked once in the organisation profile's stages and are the same columns. Address and website are NOT asked: the server has no
// column for them and dropped them silently (G12 P-3), so a form that offered them promised what it did not keep. Relative imports only.

export interface CompanyForm { name: string; contactName: string; contactEmail: string; contactPhone: string }

/** The server's column sizes (grc_tenants). */
export const LIMITS = { name: 255, contactName: 255, contactEmail: 255, contactPhone: 50 } as const;

type Field = keyof CompanyForm;

/** The form's field -> the server's field. */
export const SERVER_FIELD: Record<Field, string> = { name: 'name', contactName: 'primary_contact_name', contactEmail: 'primary_contact_email', contactPhone: 'primary_contact_phone' };

export interface CompanyRecord { name?: string | null; primary_contact_name?: string | null; primary_contact_email?: string | null; primary_contact_phone?: string | null }

export const EMPTY_FORM: CompanyForm = { name: '', contactName: '', contactEmail: '', contactPhone: '' };

/** The form a saved record fills (a missing value is an empty box; the server's "Not configured" placeholder name is shown as it is). */
export function formOf(record: CompanyRecord | null | undefined): CompanyForm {
  return {
    name: record?.name ?? '',
    contactName: record?.primary_contact_name ?? '',
    contactEmail: record?.primary_contact_email ?? '',
    contactPhone: record?.primary_contact_phone ?? '',
  };
}

const trimmed = (form: CompanyForm): CompanyForm => ({ name: form.name.trim(), contactName: form.contactName.trim(), contactEmail: form.contactEmail.trim(), contactPhone: form.contactPhone.trim() });

/** Whether the form differs from what is saved (spaces round a value do not count). */
export const isDirty = (saved: CompanyForm, form: CompanyForm): boolean => (Object.keys(SERVER_FIELD) as Field[]).some((k) => trimmed(saved)[k] !== trimmed(form)[k]);

/** What to send: only the fields that changed, trimmed, under the server's names (the server keeps every field a request does not name). */
export function bodyOf(saved: CompanyForm, form: CompanyForm): Record<string, string> {
  const now = trimmed(form);
  const before = trimmed(saved);
  const body: Record<string, string> = {};
  (Object.keys(SERVER_FIELD) as Field[]).forEach((k) => { if (now[k] !== before[k]) body[SERVER_FIELD[k]] = now[k]; });
  return body;
}

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is wrong with the form, field by field, in the words the person reads (nothing for a field that is fine). */
export function errorsOf(form: CompanyForm): Partial<Record<Field, string>> {
  const f = trimmed(form);
  const errors: Partial<Record<Field, string>> = {};
  if (!f.name) errors.name = 'Enter the name of the organisation.';
  else if (f.name.length > LIMITS.name) errors.name = `Use at most ${LIMITS.name} characters.`;
  if (f.contactName.length > LIMITS.contactName) errors.contactName = `Use at most ${LIMITS.contactName} characters.`;
  if (f.contactEmail && !LOOKS_LIKE_EMAIL.test(f.contactEmail)) errors.contactEmail = 'Enter an e-mail address such as name@company.com.';
  else if (f.contactEmail.length > LIMITS.contactEmail) errors.contactEmail = `Use at most ${LIMITS.contactEmail} characters.`;
  if (f.contactPhone.length > LIMITS.contactPhone) errors.contactPhone = `Use at most ${LIMITS.contactPhone} characters.`;
  return errors;
}

export const hasErrors = (form: CompanyForm): boolean => Object.keys(errorsOf(form)).length > 0;

/** The primary contact's e-mail is changing: it decides who is an administrator and the e-mail domain new users must have (auth_router.is_tenant_admin, admin_router.get_tenant_email_domain). */
export const contactEmailChanged = (saved: CompanyForm, form: CompanyForm): boolean => trimmed(saved).contactEmail.toLowerCase() !== trimmed(form).contactEmail.toLowerCase();

/** The (i) beside the e-mail field. */
export const CONTACT_EMAIL_INFO = 'This e-mail also makes its owner an administrator of the organisation, and its domain is the one new users must have. Change it only on purpose.';

/** The question asked when the e-mail is changed: what happens, in plain words. */
export function contactEmailQuestion(saved: CompanyForm, form: CompanyForm): { title: string; message: string; confirmLabel: string } {
  const now = trimmed(form).contactEmail;
  const before = trimmed(saved).contactEmail;
  const message = now
    ? `${now} becomes an administrator, and new users must have an e-mail address in the same domain.${before ? ` ${before} stays an administrator only if they hold the Administrator role.` : ''}`
    : `With no e-mail here nobody is an administrator through the primary contact, and new users can have any e-mail domain.${before ? ` ${before} stays an administrator only if they hold the Administrator role.` : ''}`;
  return { title: 'Change the primary contact e-mail?', message, confirmLabel: 'Change e-mail' };
}

export const SAVED = { title: 'Company details saved', message: 'The name and primary contact are updated.' } as const;
export const SAVE_FAILED = "Company details weren't saved";
