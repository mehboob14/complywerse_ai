'use client';

// Teams are departments now (Administration → Departments). This page stays only so an old bookmark or link to /admin/teams lands
// on the Departments tab.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function TeamsMovedPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin?tab=departments'); }, [router]);
  return <p className="p-6 text-sm text-[#3f4b58]">Teams are now Departments. Opening Administration → Departments…</p>;
}
