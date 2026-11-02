'use client';

// What a view looks like while it loads: grey blocks that pulse (the global reduced-motion rule stills them). The blocks say nothing to a
// screen reader; the wrapper of a group (SkeletonLines, SkeletonRows) says "Loading" once and marks itself busy.
import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export interface SkeletonProps {
  /** the size, in arbitrary values: `h-[16px] w-[120px]` */
  className?: string;
}

/** One block. */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden className={clsx('animate-pulse rounded-ds-control bg-ds-border', className)} />;
}

function Busy({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" className={clsx('relative', className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export interface SkeletonLinesProps {
  /** how many lines (default 3); the last one is shorter */
  lines?: number;
  /** what a screen reader says (default "Loading") */
  label?: string;
  className?: string;
}

/** Lines of text. */
export function SkeletonLines({ lines = 3, label = 'Loading', className }: SkeletonLinesProps) {
  const n = Math.max(1, Math.floor(lines));
  return (
    <Busy label={label} className={className}>
      <div className="space-y-2">
        {Array.from({ length: n }, (_, i) => <Skeleton key={i} className={clsx('h-[12px]', i === n - 1 && n > 1 ? 'w-[60%]' : 'w-full')} />)}
      </div>
    </Busy>
  );
}

export interface SkeletonRowsProps {
  /** table rows (default 5) */
  rows?: number;
  /** cells in a row (default 4) */
  columns?: number;
  label?: string;
  className?: string;
}

const WIDTH = ['w-[70%]', 'w-[45%]', 'w-[60%]', 'w-[35%]', 'w-[55%]'];

/** Table rows: a block per cell, in widths that differ so it reads as a table and not as a stripe. */
export function SkeletonRows({ rows = 5, columns = 4, label = 'Loading', className }: SkeletonRowsProps) {
  const cols = Math.max(1, Math.floor(columns));
  return (
    <Busy label={label} className={className}>
      {Array.from({ length: Math.max(0, Math.floor(rows)) }, (_, r) => (
        <div
          key={r}
          className="grid items-center gap-[16px] border-b border-ds-border px-[12px] py-[14px] last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }, (_c, c) => <Skeleton key={c} className={clsx('h-[12px]', WIDTH[(r + c) % WIDTH.length])} />)}
        </div>
      ))}
    </Busy>
  );
}
