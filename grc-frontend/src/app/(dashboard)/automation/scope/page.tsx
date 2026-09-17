'use client';

// Scope is configured from Common controls (the Configure scope dialog). This
// route stays so existing links and bookmarks land on it.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function AutomationScopeRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/automation/soc2-controls?configure=scope');
  }, [router]);
  return (
    <div className="flex h-48 items-center justify-center text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}
