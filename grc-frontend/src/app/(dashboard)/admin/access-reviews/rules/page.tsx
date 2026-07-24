'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AccessReviewsRulesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/compliance/access-reviews/rules');
  }, [router]);
  return null;
}
