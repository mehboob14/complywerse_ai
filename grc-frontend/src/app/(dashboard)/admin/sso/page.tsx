'use client';

// Administration > Single sign-on: how people sign in with the organisation's identity provider (Microsoft Entra: sign-in, group mapping, provisioning).
// The card is the same one the old Identity Providers tab mounted; the Access Review sources that share it belong to Access Reviews and are not edited here.
import { PageHeader } from '@/components/ui';
import { IdentityProvidersCard } from '@/components/integrations/IdentityProvidersCard';

export default function SingleSignOnPage() {
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader variant="page" title="Single sign-on" info="How people sign in with the organisation's own accounts, which groups get which role, and who is created on first sign-in." />
      <IdentityProvidersCard />
    </div>
  );
}
