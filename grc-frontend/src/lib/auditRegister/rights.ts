// What a person may do in the Issue Register, apart from React so `node --test` pins it (rights.test.ts re-reads the router and fails when this table and the server disagree).
// The server asks for four rights on the register's routes (routers/audit_register.py): view reads, edit lets an owner submit validation materials and ask for an extension, create is
// Audit Services' desk (upload, edit fields, decide validation and extensions, mappings, settings, reminders) and delete removes or restores a finding. The page draws a control only
// for a person who holds the right the route asks for, so a button never answers "Permission denied" and nothing the server allows is hidden from someone who may do it.
// Nothing here changes who may do what: it mirrors the server (a gap between them is a decision for the user, listed in the plan, not a rule written here).

export type RegisterRight = 'view' | 'edit' | 'create' | 'delete';
export interface RegisterRights { view: boolean; edit: boolean; create: boolean; delete: boolean }

export const RIGHT_KEYS: Record<RegisterRight, string> = {
  view: 'issue_management:issues:view',
  edit: 'issue_management:issues:edit',
  create: 'issue_management:issues:create',
  delete: 'issue_management:issues:delete',
};

export const rightsOf = (has: (key: string) => boolean): RegisterRights => ({
  view: has(RIGHT_KEYS.view), edit: has(RIGHT_KEYS.edit), create: has(RIGHT_KEYS.create), delete: has(RIGHT_KEYS.delete),
});

/** Every action of the page and the right its route asks for. `ACTION_ROUTE` says which route that is, so a test can check the table against the router. */
export const ACTION_RIGHT = {
  read: 'view',
  downloadTemplate: 'view',
  exportPack: 'view',
  readSettings: 'view',
  readReportCatalog: 'view',
  submitValidation: 'edit',
  requestExtension: 'edit',
  upload: 'create',
  importWorkbook: 'create',
  readImports: 'create',
  editFields: 'create',
  addFinding: 'create',
  assist: 'create',
  relink: 'create',
  suggestions: 'create',
  decideValidation: 'create',
  decideExtension: 'create',
  regulatorNotice: 'create',
  regulatorStatus: 'create',
  readReminders: 'create',
  sendReminders: 'create',
  readMappings: 'create',
  writeMappings: 'create',
  writeSettings: 'create',
  writeReportCatalog: 'create',
  deleteFinding: 'delete',
  restoreFinding: 'delete',
} as const satisfies Record<string, RegisterRight>;

export type RegisterAction = keyof typeof ACTION_RIGHT;

/** The route (method and path under /issue-management/issues/audit-register) each action calls first, for the test that reads the router. */
export const ACTION_ROUTE: Record<RegisterAction, [string, string]> = {
  read: ['get', '/rows'],
  downloadTemplate: ['get', '/template'],
  exportPack: ['get', '/pack/export'],
  readSettings: ['get', '/settings'],
  readReportCatalog: ['get', '/report-catalog'],
  submitValidation: ['post', '/validation/{issue_id}/submit'],
  requestExtension: ['post', '/extensions/{issue_id}'],
  upload: ['post', '/preview'],
  importWorkbook: ['post', '/import'],
  readImports: ['get', '/imports'],
  editFields: ['patch', '/profile/{issue_id}'],
  addFinding: ['post', '/findings'],
  assist: ['post', '/assist'],
  relink: ['post', '/relink'],
  suggestions: ['get', '/suggestions/{issue_id}'],
  decideValidation: ['post', '/validation/{issue_id}/decide'],
  decideExtension: ['post', '/extensions/decide/{request_id}'],
  regulatorNotice: ['post', '/extensions/regulator-notice/{request_id}'],
  regulatorStatus: ['patch', '/regulator-status/{issue_id}'],
  readReminders: ['get', '/reminders'],
  sendReminders: ['post', '/reminders'],
  readMappings: ['get', '/mappings/owners'],
  writeMappings: ['put', '/mappings/owners'],
  writeSettings: ['put', '/settings'],
  writeReportCatalog: ['post', '/report-catalog'],
  deleteFinding: ['delete', '/findings/{issue_id}'],
  restoreFinding: ['post', '/findings/{issue_id}/restore'],
};

export const can = (rights: RegisterRights, action: RegisterAction): boolean => rights[ACTION_RIGHT[action]];

/** A person who owns findings but is not Audit Services (edit without create): the register opens on "Mine" for them. Audit Services and read-only people open on everything. */
export const isOwnerRole = (r: RegisterRights): boolean => r.view && r.edit && !r.create;

// ── Setup: the sections a person can read ──
export type SetupSection = 'owners' | 'imports' | 'reminders' | 'reports' | 'lists' | 'numbering';
export const SETUP_LABELS: Record<SetupSection, string> = {
  owners: 'Owners and units',
  imports: 'Imports',
  reminders: 'Reminders and SLAs',
  reports: 'Reports and exams',
  lists: 'Dropdown lists',
  numbering: 'Issue # numbering',
};

/** The Setup sections a person has the right to read: the mappings and the import history are read with `create` (the server's GETs ask for it); the settings with `view`. */
export function setupSections(r: RegisterRights): SetupSection[] {
  const out: SetupSection[] = [];
  if (can(r, 'readMappings')) out.push('owners');
  if (can(r, 'readImports')) out.push('imports');
  if (can(r, 'readSettings')) out.push('reminders', 'reports', 'lists', 'numbering');
  return out;
}
