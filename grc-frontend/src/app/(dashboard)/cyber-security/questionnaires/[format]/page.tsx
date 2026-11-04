'use client';

// The questionnaire of one Cyber Security assessment type, as uploaded: the page where it is uploaded or replaced. Assessments are started from it
// (components/compliance/scoping/AssessmentTypePage.tsx) and never change it.
import { useParams } from 'next/navigation';
import { ErrorState } from '@/components/ui/ds';
import { PageHeading } from '@/components/ui/ds/PageHeading';
import { QuestionnaireTab } from '@/components/compliance/scoping/AssessmentWorkspace';
import { TYPE_INFO } from '@/components/compliance/scoping/scopingModel';

export default function CyberQuestionnairePage() {
  const format = useParams<{ format: string }>()?.format ?? '';
  const info = TYPE_INFO[format];
  if (!info) return <div className="mx-auto max-w-7xl"><ErrorState title="No such assessment type" message="The address does not name a Cyber Security assessment type." /></div>;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-[16px]">
      <PageHeading
        title={`${info.label} questionnaire`}
        info="The questions as uploaded. Each assessment starts from a copy of them without their answers; a new workbook changes the questions of assessments started afterwards, not those already started."
        back={{ href: `/cyber-security?tab=${info.tab}`, label: `Back to ${info.label}` }}
      />
      <QuestionnaireTab format={format} allowUpload />
    </div>
  );
}
