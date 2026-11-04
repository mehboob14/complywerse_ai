'use client';

// One Cyber Security assessment: its scope, people and plan while it is a draft, then its questionnaire (components/compliance/scoping/AssessmentWorkspace.tsx).
import { useParams } from 'next/navigation';
import { ErrorState } from '@/components/ui/ds';
import AssessmentWorkspace from '@/components/compliance/scoping/AssessmentWorkspace';

export default function CyberAssessmentPage() {
  const raw = useParams<{ id: string }>()?.id ?? '';
  const id = /^\d+$/.test(raw) ? Number(raw) : 0;
  if (id < 1) return <div className="mx-auto max-w-7xl"><ErrorState title="No such assessment" message="The address does not name an assessment." /></div>;
  return <AssessmentWorkspace key={id} id={id} />;                         // another assessment starts from nothing: no edit of this one is carried over
}
