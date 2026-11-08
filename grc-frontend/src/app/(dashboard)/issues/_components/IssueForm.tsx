'use client';

// The Create issue form is the kit's drawer now (components/issue-management/IssueDrawer.tsx), shared with the Create issue button of every record's page. This file keeps the old name and
// props so the Issues page's `<IssueForm open onClose />` needs no edit; the Issues builders move to the drawer's own name when they replace the page.
export { IssueDrawer as IssueForm } from '@/components/issue-management/IssueDrawer';
export type { IssueDrawerProps as IssueFormProps } from '@/components/issue-management/IssueDrawer';
