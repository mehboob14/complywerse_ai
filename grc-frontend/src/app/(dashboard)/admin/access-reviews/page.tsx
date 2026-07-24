'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Legacy URL — Access Reviews now lives under Compliance. */
export default function AccessReviewsAdminRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/compliance/access-reviews');
  }, [router]);
  return null;
}
