'use client';

// /frameworks/onboarding: the third tab of Frameworks. Every framework of the library with where its onboarding stands; the work before a framework's compliance journey may start
// (components/compliance/onboarding/register/OnboardingRegister.tsx). The static segment `onboarding` wins over the `[id]` journey page beside it, so this address never reaches a journey.
// The heading and the strip are this page's; the register under them is the onboarding module's.
import { PageHeader } from '@/components/ui';
import { Button } from '@/components/ui/ds';
import OnboardingRegister from '@/components/compliance/onboarding/register/OnboardingRegister';
import { titleFor } from '@/lib/navRegistry';
import { FrameworksStrip } from '../_hub/FrameworksStrip';

export default function FrameworkOnboardingPage() {
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[12px]">
        <PageHeader
          variant="page"
          title={titleFor('/frameworks/onboarding') ?? 'Onboarding'}
          info="What a framework needs before its journey can start: its scope, owners and dates, settled once and approved. A framework that is already running can be marked underway, with a reason."
          actions={<Button href="/admin?tab=profile">Organisation Profile</Button>}
        />
        <FrameworksStrip current="onboarding" />
      </div>
      <OnboardingRegister />
    </div>
  );
}
