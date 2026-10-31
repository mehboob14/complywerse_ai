'use client';

// /is-projects/my-projects: the projects I own or am a member of, on their own (the Projects page shows the same thing as its My Projects tab). The pieces are in ../_MyProjects.tsx.
import { PageHeader } from '@/components/ui';
import { titleFor } from '@/lib/navRegistry';
import { MyProjects } from '../_MyProjects';

export default function MyProjectsPage() {
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader variant="page" title={titleFor('/is-projects/my-projects') ?? 'My Projects'} info="Projects you own or are a team member of" />
      <MyProjects />
    </div>
  );
}
