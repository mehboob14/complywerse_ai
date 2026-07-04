'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { AttentionItem } from './types';

/**
 * Attention queue — 9 named counts + total. Counts are actions-needed, NOT
 * parts of a whole, so they are rendered as a tile grid (never a pie/donut).
 * Zero-count tiles read intentionally muted. Each tile deep-links to the page
 * that clears it.
 */
export default function AttentionQueue({ items, total }: { items: AttentionItem[]; total: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-600" />
          <span className="text-sm font-semibold text-slate-800">Attention Queue</span>
        </div>
        <span className="rounded-full bg-rose-600 px-2.5 py-0.5 text-[11px] font-bold text-white">{total}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => {
          const active = item.count > 0;
          return (
            <Link
              key={item.key}
              href={item.href}
              title={item.label}
              className="group relative overflow-hidden rounded-xl border border-slate-100 p-2.5 transition-colors hover:border-slate-300 hover:bg-slate-50/70"
            >
              <span
                className="absolute inset-y-0 left-0 w-[3px]"
                style={{ backgroundColor: active ? item.color : '#e2e8f0' }}
              />
              <div className={`text-[22px] font-bold leading-none ${active ? 'text-slate-900' : 'text-slate-300'}`}>
                {item.count}
              </div>
              <div className="mt-1.5 line-clamp-2 text-[9.5px] leading-tight text-slate-500">{item.label}</div>
              <ArrowRight className="absolute bottom-2 right-2 h-3 w-3 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
