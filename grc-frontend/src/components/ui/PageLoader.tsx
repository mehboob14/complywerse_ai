'use client';

import * as React from 'react';

/**
 * Shared loading indicator used across the platform.
 *
 * Twelve small dots are placed evenly around a circle. Each dot pulses
 * (scale + opacity) on a 1.2s cycle, with each successive dot delayed by
 * 100 ms — so a smooth wave travels around the ring. A faint halo behind
 * the dots breathes in counter-phase, and the whole assembly rotates
 * slowly so the wave doesn't feel anchored to one position.
 *
 * The visual intent matches the "loading-circle" Lottie reference, but
 * the animation is pure CSS / SVG — no Lottie runtime, no extra bundle
 * weight, no network fetch. Keyframes (`pageLoaderDot`, `pageLoaderHalo`,
 * `pageLoaderSpin`) live in `globals.css`.
 */
export type PageLoaderSize = 'sm' | 'md' | 'lg';

export interface PageLoaderProps {
  size?: PageLoaderSize;
  label?: string;
  /** Render only the spinner without the centering wrapper. */
  inline?: boolean;
  /** Extra classes on the outer wrapper (e.g. `h-64` to set its parent height). */
  className?: string;
}

const SIZE_PX: Record<PageLoaderSize, number> = {
  sm: 32,
  md: 56,
  lg: 80,
};

const DOT_PX: Record<PageLoaderSize, number> = {
  sm: 4,
  md: 6,
  lg: 8,
};

const DOT_COUNT = 12;
const DOT_COLOR = 'var(--color-base)'; // brand colour from tokens.css

export function PageLoader({
  size = 'md',
  label,
  inline = false,
  className = '',
}: PageLoaderProps) {
  const px = SIZE_PX[size];
  const dotPx = DOT_PX[size];
  const radius = (px - dotPx) / 2;
  const center = px / 2;

  const spinner = (
    <span
      className="relative inline-block"
      style={{
        width: px,
        height: px,
        animation: 'pageLoaderSpin 6s linear infinite',
      }}
      role="status"
      aria-label={label || 'Loading'}
    >
      {/* Soft halo behind the dots */}
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'radial-gradient(circle, color-mix(in srgb, var(--color-base) 18%, transparent) 0%, transparent 70%)',
          animation: 'pageLoaderHalo 2.4s ease-in-out infinite',
        }}
      />
      {/* Dot wave — twelve dots evenly spaced, each delayed by 100 ms */}
      {Array.from({ length: DOT_COUNT }).map((_, i) => {
        const angle = (i / DOT_COUNT) * Math.PI * 2 - Math.PI / 2;
        const x = center + radius * Math.cos(angle) - dotPx / 2;
        const y = center + radius * Math.sin(angle) - dotPx / 2;
        return (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              width: dotPx,
              height: dotPx,
              left: x,
              top: y,
              backgroundColor: DOT_COLOR,
              animation: `pageLoaderDot 1.2s ease-in-out infinite`,
              animationDelay: `${(i * 0.1).toFixed(2)}s`,
              transformOrigin: 'center',
            }}
          />
        );
      })}
    </span>
  );

  if (inline) {
    return spinner;
  }

  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      {spinner}
      {label && <p className="text-sm text-gray-500">{label}</p>}
    </div>
  );
}

export default PageLoader;
