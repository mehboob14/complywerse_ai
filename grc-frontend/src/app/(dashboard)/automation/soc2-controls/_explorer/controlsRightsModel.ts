// What the SERVER lets a person do on the Controls Automation pages, read from the rights they hold. The server checks a right by its exact name (require_tenant_permission: the person's roles must
// hold that very permission, or the person is an administrator): "compliance:frameworks:*" is the permission called that, not "any right on frameworks". The platform's usePermissions().hasPermission
// reads a trailing ":*" as "any right under it", which would show the buttons of a person who may only read; so these pages ask for the exact name. Nothing here grants or removes a right: a button the
// server would refuse is shown disabled, with the reason, and a button it allows is never hidden.

/** The rights of the area, each by the name the server checks (automation/router.py, scf/router.py, assurance.py). */
export const RIGHT = {
  /** choose the scope; create, freeze and close audit periods (scf/router.py `_require_fw_write`) */
  frameworks: 'compliance:frameworks:*',
  /** assign owners, in bulk and one by one */
  assign: 'controls:controls:assign',
  /** create a custom control */
  createControl: 'controls:control_library:create',
  /** refresh the checks, connect, test and collect, record a mapping decision */
  scan: 'compliance:scan:execute',
} as const;

export type RightKey = keyof typeof RIGHT;

export const NO_RIGHT: Record<RightKey, string> = {
  frameworks: 'You need the right to manage frameworks.',
  assign: 'You need the right to assign owners.',
  createControl: 'You need the right to create controls.',
  scan: 'You need the right to run scans.',
};

/** Whether a person holds a right as the server reads it: an administrator, or a role that holds that exact permission. */
export function holds(right: string, held: readonly string[], isAdmin: boolean): boolean {
  return isAdmin || held.includes(right);
}
