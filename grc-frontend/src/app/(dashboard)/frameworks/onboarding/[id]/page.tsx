'use client';

// One framework's onboarding (id = the onboarding): its steps, the review and the decisions (components/compliance/onboarding/workspace/OnboardingWorkspace.tsx).
import { useParams } from 'next/navigation';
import { ErrorState } from '@/components/ui/ds';
import OnboardingWorkspace from '@/components/compliance/onboarding/workspace/OnboardingWorkspace';

export default function FrameworkOnboardingWorkspacePage() {
  const raw = useParams<{ id: string }>()?.id ?? '';
  const id = /^\d+$/.test(raw) ? Number(raw) : 0;
  if (id < 1) return <div className="mx-auto max-w-7xl"><ErrorState title="No such onboarding" message="The address does not name an onboarding." /></div>;
  return <OnboardingWorkspace key={id} id={id} />;                         // another onboarding starts from nothing: no edit of this one is carried over
}
