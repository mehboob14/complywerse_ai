'use client';

// Draws its children only once the place they will go is near the screen (and the page's first paint is out), so a section far down a tab asks for its data when the person gets there,
// not on arrival. Until then a held box of `minHeight` stands in, named for a screen reader; once drawn it stays drawn. Without IntersectionObserver the children are drawn at once.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/ds';

export default function LazyMount({ children, minHeight = 160, label, ready = true }: { children: ReactNode; minHeight?: number; label: string; ready?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return undefined;
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return undefined; }
    const watch = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setNear(true); }, { rootMargin: '240px 0px' });
    watch.observe(el);
    return () => watch.disconnect();
  }, [near]);
  if (near && ready) return <>{children}</>;
  return (
    <div ref={box} role="status" aria-busy="true" aria-label={`Loading ${label}`} style={{ minHeight }} className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
      <Skeleton className="h-[16px] w-[160px]" />
    </div>
  );
}
