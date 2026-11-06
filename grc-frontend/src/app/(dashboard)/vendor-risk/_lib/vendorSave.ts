// What saving the Add / Edit vendor dialog does, in order, with the calls passed in so a test can stand in for the server. Pure, so
// `node --test` runs vendorSave.test.ts against it; the dialog hands it the real calls.
//
// Adding carries everything the register's old inline "Add vendor" dialog did: the tenant's own fields (custom_values) go with the
// vendor; "Start the lifecycle now" opens the vendor's first assessment afterwards (best effort: a failure there never undoes the
// vendor); a name or website already on record is refused with 409 unless `allowDuplicate`. New: a first engagement, made after the
// vendor, and the lifecycle then starts on it rather than on General.

import { apiErrorText } from '../../../../lib/apiError.ts';
import { createBody, updateBody, type VendorForm } from './vendorFormModel.ts';

export interface VendorCalls {
  createVendor: (body: Record<string, unknown>) => Promise<Record<string, any>>;
  updateVendor: (id: number, body: Record<string, unknown>) => Promise<Record<string, any>>;
  /** Adds an engagement and says its id (null when the server does not). */
  addEngagement: (vendorId: number, name: string) => Promise<number | null>;
  /** Opens the first assessment of an engagement, or of General (null). */
  startLifecycle: (vendorId: number, engagementId: number | null) => Promise<unknown>;
}

export interface Saved {
  /** the vendor as the server gives it */
  saved: Record<string, any>;
  /** something that did not go through but did not stop the save (the first engagement), in words; else null */
  note: string | null;
}

/** Add a vendor. `customValues` is what `valuesToSave` made of the tenant's fields (undefined: send none). Rejects when the vendor
 *  itself is refused (a 409 for a duplicate, a 400 for a field); nothing after it runs then. */
export async function addVendor(calls: VendorCalls, args: {
  form: VendorForm;
  customValues?: Record<string, unknown>;
  firstEngagement: string;
  startLifecycle: boolean;
  allowDuplicate: boolean;
}): Promise<Saved> {
  const body = createBody(args.form);
  if (args.customValues) body.custom_values = args.customValues;
  if (args.allowDuplicate) body.allow_duplicate = true;
  const created = await calls.createVendor(body);

  let note: string | null = null;
  let engagementId: number | null = null;
  const name = args.firstEngagement.trim();
  if (name) {
    try {
      engagementId = await calls.addEngagement(created.id, name);
    } catch (e) {
      note = `The engagement was not added: ${apiErrorText(e, 'add it from the Overview.')}`;
    }
  }
  if (args.startLifecycle) {
    try {
      await calls.startLifecycle(created.id, engagementId);
    } catch {
      /* it can be started from the vendor's page */
    }
  }
  return { saved: created, note };
}

/** Save an edit: only what changed, the tenant's fields among it (`customValues`: only those that changed). Nothing changed, nothing sent. */
export async function editVendor(calls: VendorCalls, vendor: Record<string, any>, args: {
  form: VendorForm;
  was: VendorForm;
  customValues?: Record<string, unknown>;
}): Promise<Saved> {
  const body = updateBody(args.form, args.was);
  if (args.customValues) body.custom_values = args.customValues;
  if (Object.keys(body).length === 0) return { saved: vendor, note: null };
  return { saved: await calls.updateVendor(vendor.id, body), note: null };
}
