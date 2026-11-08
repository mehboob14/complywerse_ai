// The status words of the Administration pages that read the platform's own records: the audit log, AI usage and AI governance, and the scheduled jobs. One registry per
// kind of word, on the tone model of lib/status.ts; a word nobody registered reads neutral with its own readable label, never a guess, and every word is said in words
// (never a colour alone).
//  - audit action: the verb the audit log stores per row (audit_logger.py: create / update / delete / read, `<verb>_failed` for a request the server refused, and the
//    business verbs the modules write: approve, reject, submit, archive, restore, status_changed, settings_updated...). The labels mirror `_HUMAN_VERBS` in audit_logger.py.
//  - audit change: what a request did to one record (db_changes.records[].op): created, updated, deleted.
//  - AI call: the state of one recorded AI call (usage ledger + governance log): succeeded, failed, blocked (refused before sending).
//  - budget use: where a module stands against its monthly token budget; the cut-offs are the ones the Token usage page always used (70 and 85 percent, the server's alert).
//  - scheduled job: where one recurring platform job stands (services/platform_clock.py): failing, never run, overdue, on schedule.
import { defineStatuses } from '../status.ts';

/** `GlobalAuditLog.action`. */
export const auditAction = defineStatuses('audit action', {
  create: { tone: 'success', label: 'Created' },
  created: { tone: 'success', label: 'Created' },
  update: { tone: 'progress', label: 'Updated' },
  updated: { tone: 'progress', label: 'Updated' },
  delete: { tone: 'danger', label: 'Deleted' },
  read: { tone: 'neutral', label: 'Viewed' },
  create_failed: { tone: 'warning', label: 'Create refused' },
  update_failed: { tone: 'warning', label: 'Update refused' },
  delete_failed: { tone: 'warning', label: 'Delete refused' },
  login: { tone: 'neutral', label: 'Signed in' },
  logout: { tone: 'neutral', label: 'Signed out' },
  approve: { tone: 'success', label: 'Approved' },
  approved: { tone: 'success', label: 'Approved' },
  reject: { tone: 'danger', label: 'Rejected' },
  rejected: { tone: 'danger', label: 'Rejected' },
  submit: { tone: 'pending', label: 'Submitted' },
  submitted: { tone: 'pending', label: 'Submitted' },
  publish: { tone: 'success', label: 'Published' },
  archive: { tone: 'neutral', label: 'Archived' },
  restore: { tone: 'progress', label: 'Restored' },
  import: { tone: 'progress', label: 'Imported' },
  export: { tone: 'neutral', label: 'Exported' },
  assign: { tone: 'progress', label: 'Assigned' },
  status_changed: { tone: 'progress', label: 'Status changed' },
  settings_updated: { tone: 'progress', label: 'Settings changed' },
});

/** One record's change inside a request (`db_changes.records[].op`). */
export const auditChange = defineStatuses('audit change', {
  created: { tone: 'success', label: 'Added' },
  updated: { tone: 'progress', label: 'Changed' },
  deleted: { tone: 'danger', label: 'Removed' },
});

/** One recorded AI call. `blocked` is a call the protection layer refused before anything was sent. */
export const aiCall = defineStatuses('AI call', {
  success: { tone: 'success', label: 'Succeeded' },
  succeeded: { tone: 'success', label: 'Succeeded' },
  completed: { tone: 'success', label: 'Succeeded' },
  ok: { tone: 'success', label: 'Succeeded' },
  error: { tone: 'danger', label: 'Failed' },
  failed: { tone: 'danger', label: 'Failed' },
  blocked: { tone: 'warning', label: 'Refused' },
  cache_hit: { tone: 'neutral', label: 'Answered from saved result' },
});

/** A module's token use against its monthly budget (Token usage: 70 percent and over watch, 85 percent and over is the alert). */
export const budgetUse = defineStatuses('budget use', {
  ok: { tone: 'success', label: 'Within budget' },
  watch: { tone: 'warning', label: 'Nearing budget' },
  over: { tone: 'danger', label: 'Near the limit' },
});

/** A platform job on the Scheduled jobs page. */
export const scheduledJob = defineStatuses('scheduled job', {
  failing: { tone: 'danger', label: 'Could not be queued' },
  never: { tone: 'neutral', label: 'Not run yet' },
  overdue: { tone: 'warning', label: 'Overdue' },
  on_schedule: { tone: 'success', label: 'On schedule' },
});
