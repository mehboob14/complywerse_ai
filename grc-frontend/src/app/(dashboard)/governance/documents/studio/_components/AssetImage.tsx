'use client';

import { useQuery } from '@tanstack/react-query';
import { studioApi } from '@/lib/studio/api';

/** A logo from the studio. Images need the sign-in token, so the picture is fetched and shown from memory. */
export default function AssetImage({ id, alt, className }: { id: number; alt: string; className?: string }) {
  const url = useQuery({
    queryKey: ['studio', 'asset-url', id],
    queryFn: async () => URL.createObjectURL(await studioApi.assetBlob(id)),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });
  if (!url.data) return <span className={`inline-block bg-[#eef1f4] ${className ?? ''}`} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url.data} alt={alt} className={className} />;
}
