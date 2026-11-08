'use client';

import PermissionGuard from '@/components/ui/PermissionGuard';
import { navPermissions } from '@/components/layout/navAccess';
import UsersRegister from '@/components/admin/people/UsersRegister';

// The user menu's "Users" for a person who holds the users right and is not an administrator (an administrator goes to Administration > Users): the same register as
// Administration > Users, with the same rights, so the two doors cannot disagree. Without the right, the no-access page. (It used to read the fields of
// /tenants/{id}/users as if they were flat, so every row said "Unknown User"; the register reads /admin/users, which needs this same right.)
export default function GuardedUsersPage() {
  return <PermissionGuard required={navPermissions('/users')}><UsersRegister /></PermissionGuard>;
}
