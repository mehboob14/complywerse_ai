'use client';

// Complyverse wordmark — "Comply" in near-black, "verse" in teal, with a small
// superscript AI badge. `variant` flips the palette for dark vs. light panels.
export function BrandLogo({
  variant = 'dark',
  className = '',
}: {
  variant?: 'light' | 'dark';
  className?: string;
}) {
  const comply = variant === 'light' ? 'text-white' : 'text-slate-900';
  const verse = variant === 'light' ? 'text-primary-300' : 'text-primary-700';
  const ai = variant === 'light' ? 'text-primary-300' : 'text-primary-700';
  return (
    <span className={`inline-flex items-start gap-0 font-bold tracking-tight ${className}`}>
      <span className={comply}>Comply</span>
      <span className={verse}>verse</span>
      <span className={`ml-1 mt-[0.1em] text-[0.42em] font-semibold tracking-wider ${ai}`}>AI</span>
    </span>
  );
}

export default BrandLogo;
