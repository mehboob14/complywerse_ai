'use client';

import { useId } from 'react';

// Complyverse logo — a 3D orb (the internet-facing attack surface) with an orbiting
// radar ring + a detected blip, beside the "Complyverse" wordmark. Matches the favicon.
// `variant` flips the wordmark palette for dark vs. light panels.
export function BrandLogo({
  variant = 'dark',
  className = '',
}: {
  variant?: 'light' | 'dark';
  className?: string;
}) {
  const gid = useId();
  const word = variant === 'light' ? 'text-white' : 'text-slate-900';
  const ai = variant === 'light' ? 'text-primary-200' : 'text-primary-600';
  return (
    <span className={`inline-flex items-center gap-[0.45em] font-bold tracking-tight ${className}`}>
      <svg viewBox="0 0 64 64" fill="none" aria-hidden className="h-[1.25em] w-[1.25em] shrink-0">
        <defs>
          <radialGradient id={gid} cx="0.36" cy="0.30" r="0.9">
            <stop offset="0" stopColor="#B3CDE0" />
            <stop offset="0.42" stopColor="#3279A3" />
            <stop offset="1" stopColor="#011F4B" />
          </radialGradient>
        </defs>
        <ellipse cx="32" cy="32" rx="30" ry="11" fill="none" stroke="#6497B1" strokeWidth="2.6" opacity="0.55" transform="rotate(-22 32 32)" />
        <circle cx="32" cy="32" r="17" fill={`url(#${gid})`} />
        <ellipse cx="25.5" cy="25" rx="5.5" ry="3.6" fill="#ffffff" opacity="0.5" />
        <circle cx="57" cy="25" r="2.9" fill="#6497B1" />
      </svg>
      <span className="inline-flex items-start">
        <span className={word}>Complyverse</span>
        <span className={`ml-1 mt-[0.1em] text-[0.42em] font-semibold tracking-wider ${ai}`}>AI</span>
      </span>
    </span>
  );
}

export default BrandLogo;
