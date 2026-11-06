'use client';

// /frameworks/onboarding: the third tab of Frameworks. Every framework of the library with where its onboarding stands; the work before a
// framework's compliance journey may start (components/compliance/onboarding/register/OnboardingRegister.tsx). The static segment `onboarding` wins
// over the `[id]` journey page beside it, so this address never reaches a journey.
import OnboardingRegister from '@/components/compliance/onboarding/register/OnboardingRegister';
import { FrameworksTabs } from '../_components/FrameworksTabs';

export default function FrameworkOnboardingPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <FrameworksTabs />
      <OnboardingRegister />
    </div>
  );
}
