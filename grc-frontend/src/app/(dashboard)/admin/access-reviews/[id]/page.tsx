'use client';

import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

export default function AccessReviewsDetailRedirect() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  useEffect(() => {
    const id = params?.id;
    const stage = searchParams?.get('stage');
    const qs = stage ? `?stage=${encodeURIComponent(stage)}` : '';
    router.replace(`/compliance/access-reviews/${id}${qs}`);
  }, [router, params, searchParams]);
  return null;
}
