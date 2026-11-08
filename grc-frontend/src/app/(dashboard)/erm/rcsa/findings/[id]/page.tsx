'use client';

// The old finding page is the register's details panel now: this address keeps working and lands on it.
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function RcsaFindingRedirect() {
  const router = useRouter();
  const params = useParams();
  const raw = Array.isArray(params?.id) ? params.id[0] : params?.id;
  useEffect(() => { router.replace(/^\d+$/.test(String(raw)) ? `/erm/rcsa/findings?open=${raw}` : '/erm/rcsa/findings'); }, [router, raw]);
  return null;
}
