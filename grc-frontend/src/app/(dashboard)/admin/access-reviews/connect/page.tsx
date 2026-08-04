'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AccessReviewsConnectRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/compliance/access-reviews/connect');
  }, [router]);
  return null;
}
