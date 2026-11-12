'use client';

/**
 * Internal Control detail has moved into the unified Control Library workbench.
 * Redirect to the library's internal mode, carrying the control id.
 * shortcut: /controls does not read `control` yet (it only reads `mode`), so the user lands on the
 * internal list; when it learns to open `?control=<id>` in its drawer, this link opens the control directly.
 */
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function InternalControlDetailRedirect() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  useEffect(() => {
    router.replace(`/controls?mode=internal${id ? `&control=${encodeURIComponent(id)}` : ''}`);
  }, [router, id]);
  return null;
}
