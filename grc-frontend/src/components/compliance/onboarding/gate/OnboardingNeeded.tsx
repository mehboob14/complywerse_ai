'use client';

/**
 * What the screens that start a journey show for a framework whose onboarding is not finished: a notice "Onboarding needed" with one button that opens the
 * onboarding (or makes it first). `useOnboardingGates` reads the register once for any number of frameworks; the server's 409 (`onboarding_required`) shows the
 * same notice, in case the data on the screen was stale. The gate itself is the server's.
 */
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Button, Notice, useNotify } from '@/components/ui/ds';
import { ONBOARDING_KEYS, onboardingApi, problemOf, type OnboardingState } from '@/lib/frameworkOnboarding';
import { startRefusalWords, workspaceHref } from '../register/registerModel';
import { gateFacts, neededWords, startLabel, type GateFacts } from './gateModel';

/** Does a framework's journey wait for its onboarding? One read of the register answers for every framework on the screen; the result is null until the register has
 *  answered (or when it does not list the framework): then the screen behaves as it always did and the server decides. */
export function useOnboardingGates(): (frameworkId: number) => GateFacts | null {
  const register = useQuery({ queryKey: ONBOARDING_KEYS.register, queryFn: onboardingApi.register, staleTime: 30_000 });
  return (frameworkId) => gateFacts(register.data?.frameworks, frameworkId);
}

/** Opens the framework's onboarding; one that does not exist yet is started first, then opened. */
export function OnboardingButton({ frameworkId, onboardingId, state }: { frameworkId: number; onboardingId: number | null; state: OnboardingState | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const start = useMutation({
    mutationFn: () => onboardingApi.start(frameworkId),
    onSuccess: (view) => {
      qc.setQueryData(ONBOARDING_KEYS.detail(view.id), view);
      void qc.invalidateQueries({ queryKey: ONBOARDING_KEYS.register });
      router.push(workspaceHref(view.id));
    },
    onError: (e) => { const p = problemOf(e); notify.error(startRefusalWords(p.status, p.message), { title: "Couldn't start the onboarding" }); },
  });
  if (onboardingId != null) return <Button size="sm" variant="primary" href={workspaceHref(onboardingId)} rightIcon={<ArrowRight aria-hidden />}>{startLabel(onboardingId, state)}</Button>;
  return <Button size="sm" variant="primary" loading={start.isPending} onClick={() => start.mutate()}>{startLabel(null, state)}</Button>;
}

export function OnboardingNeeded({ frameworkId, name, onboardingId, state, open = 0, className }: {
  frameworkId: number;
  /** which framework, on a screen that lists several */
  name?: string;
  onboardingId: number | null;
  state: OnboardingState | null;
  /** how many required items the server listed as open, when it refused */
  open?: number;
  className?: string;
}) {
  return (
    <Notice tone="warning" role="status" title="Onboarding needed" className={className} action={<OnboardingButton frameworkId={frameworkId} onboardingId={onboardingId} state={state} />}>
      {name ? `${name}. ` : ''}{neededWords(state, open)}
    </Notice>
  );
}
