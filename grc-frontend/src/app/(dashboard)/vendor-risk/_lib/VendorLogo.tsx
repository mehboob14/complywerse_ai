'use client';

// A supplier's logo from its own website, or its initials. Lists pass `cachedOnly`
// so opening a list never makes the server fetch anything; the supplier's own
// page fetches it the first time.

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import apiClient from '@/lib/api';

export default function VendorLogo({ vendorId, name, size = 28, cachedOnly = false, className }: {
  vendorId: number; name: string; size?: number; cachedOnly?: boolean; className?: string;
}) {
  const { data: blob } = useQuery({
    queryKey: ['tprm-vendor-logo', vendorId, cachedOnly],
    queryFn: async () => {
      const res = await apiClient.get(`/vendor-risk/vendors/${vendorId}/logo`, {
        params: cachedOnly ? { cached_only: true } : {}, responseType: 'blob', validateStatus: (s) => s === 200 || s === 204,
      });
      return res.status === 200 ? (res.data as Blob) : null;
    },
    staleTime: 60 * 60_000,
    retry: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return undefined; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  const box = { width: size, height: size };
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- a blob URL from our own API, not an optimisable asset
    <img src={url} alt="" style={box} className={clsx('shrink-0 rounded-md border border-slate-200 bg-white object-contain p-0.5', className)} />
  ) : (
    <span aria-hidden style={{ ...box, fontSize: Math.max(10, size * 0.38) }}
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-md bg-slate-100 font-semibold text-slate-500', className)}>
      {initials}
    </span>
  );
}
