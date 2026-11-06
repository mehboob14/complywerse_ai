'use client';

// The old address of a committee (/governance/committees/<id>, with its ?tab=): a committee is a filter of the Committees home now, so this forwards there
// (lib/committeeHome.ts legacyCommitteeAddress says where each old tab lands: the sheet's Members, Charter and Settings, or the filtered lanes). Links in e-mails, reports and
// bookmarks keep working. It draws the page head while it forwards, so the screen is never blank.
import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { SkeletonLines } from '@/components/ui/ds';
import { legacyCommitteeAddress } from '@/lib/committeeHome';

export default function CommitteeForwardPage() {
  const params = useParams();
  const router = useRouter();
  const tab = useSearchParams()?.get('tab');
  const id = String(params?.id ?? '');
  useEffect(() => { router.replace(legacyCommitteeAddress(id, tab)); }, [router, id, tab]);
  return (
    <div className="space-y-[16px]" aria-busy="true">
      <PageHeader variant="page" title="Committee" />
      <SkeletonLines lines={3} label="Opening the committee" />
    </div>
  );
}
