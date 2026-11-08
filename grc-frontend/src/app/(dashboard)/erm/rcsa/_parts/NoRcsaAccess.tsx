'use client';

// The state of an RCSA page for a person the server turned away (every RCSA request needs the right to open Risk Management): said as that, never as "couldn't load" with a Retry that cannot help.
import { NoAccessState } from '@/components/ui/ds';

export function NoRcsaAccess({ what = 'RCSA' }: { what?: string }) {
  return <NoAccessState title={`You don't have access to ${what}`} reason="Ask your administrator to give you access to Risk Management." />;
}
