'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { PageLoader } from '@/components/ui';

/**
 * Client-side auth gate for the dashboard layout.
 *
 * On mount it checks localStorage for an auth token. If none is found the
 * user is immediately redirected to /login (with ?redirect= so the login
 * page can send them back after a successful sign-in). While the check is
 * running we show the standard PageLoader so there is no content flash.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      const redirect = encodeURIComponent(pathname);
      router.replace(`/login?redirect=${redirect}`);
    } else {
      setReady(true);
    }
  }, [router, pathname]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <PageLoader size="lg" />
      </div>
    );
  }

  return <>{children}</>;
}
