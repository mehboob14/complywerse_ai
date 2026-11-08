// The status words of Administration > Users and Roles & permissions, on the same tone model as lib/status.ts.
// A user is Active or Inactive (TenantUser.is_active: an inactive account cannot sign in, the server refuses its token; its roles, history and records stay).
// A role is a System role (the platform made it: Administrator) or one the organisation made. Words are said in words, never by colour alone.
import { defineStatuses } from '../status.ts';

/** TenantUser.is_active, as the Users page says it. */
export const userStatus = defineStatuses('user', {
  active: 'success',
  inactive: 'neutral',
});

/** What a role is: Role.is_system_role. */
export const roleKind = defineStatuses('role', {
  system: { tone: 'pending', label: 'System' },
  custom: { tone: 'neutral', label: 'Custom' },
});

/** What a member of a role is (the members sheet): the same words as a user. */
export const memberStatus = userStatus;
