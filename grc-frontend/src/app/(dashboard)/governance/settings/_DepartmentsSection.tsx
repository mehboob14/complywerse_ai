'use client';

// Governance > Settings: the Departments card. The departments are edited in ONE place, Administration > Departments (the tree, the level names and the members: components/admin/
// DepartmentsEditor), so this card only says how many there are and opens it (G12 P-19: the same rows were edited in two places with different power). The page is not
// guarded, so someone who holds the governance settings right and is not an administrator opens it by this link; what they may change there is what the server allows.
import { ArrowUpRight } from 'lucide-react';
import { departmentsSummary } from '@/lib/departments';
import { Button, SectionCard } from '@/components/ui/ds';
import { useAdminDepartments } from '@/components/admin/DepartmentForm';

export function DepartmentsSection() {
  const list = useAdminDepartments();
  return (
    <SectionCard
      id="departments"
      title="Departments"
      info="The departments are the one list that documents, sign-off, assets, assessments and risks pick from. They are added, renamed, nested and given members in Administration."
      meta={list.data && list.data.length > 0 ? departmentsSummary(list.data) : undefined}
      actions={<Button href="/admin/departments" rightIcon={<ArrowUpRight aria-hidden />}>Manage departments</Button>}
    />
  );
}
