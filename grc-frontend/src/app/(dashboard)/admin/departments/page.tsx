'use client';

// Administration > Departments: the one list of departments that documents, sign-off, assets, assessments, stage owners and risks pick from, as a tree with the
// organisation's own level names, with each department's people. The editor is components/admin/DepartmentsEditor (Governance > Settings links here instead of
// editing a copy); the rules that can be tested without a screen are in lib/departments.ts.
import { PageHeader } from '@/components/ui';
import { DepartmentsEditor } from '@/components/admin/DepartmentsEditor';

export default function DepartmentsAdminPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-[16px]">
      <PageHeader variant="page" title="Departments" info="Documents, sign-off, assets, assessments and risks pick from this list. A department's people are the ones added by hand, its owner and everyone who holds one of its roles." />
      <DepartmentsEditor title="All departments" />
    </div>
  );
}
