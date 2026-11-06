'use client';

// The frame of the meeting workspace: a section (a card with its heading, its count and its tools) and the outline that lists the sections and follows the reading. The page
// is ONE scroll: the outline is a sticky column from 1024px and a row of sticky pills under it; the section being read is lit (aria-current="location") as the page scrolls,
// and pressing an entry jumps there and puts focus on the section's heading. The order of the sections follows the meeting's state (lib/meetingRun.ts outlineOrder).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { outlineLabel, sectionInView, type OutlineKey } from '@/lib/meetingRun';

export function Section({ id, title, count, tools, children }: { id: OutlineKey; title: string; count?: ReactNode; tools?: ReactNode; children: ReactNode }) {
  return (
    <section id={`sec-${id}`} aria-labelledby={`sec-${id}-h`} data-section={id} className="scroll-mt-[120px] rounded-ds-card border border-ds-border bg-ds-surface">
      <div className="flex flex-wrap items-center justify-between gap-x-[8px] gap-y-[6px] border-b border-ds-border px-[16px] py-[10px]">
        <h2 id={`sec-${id}-h`} tabIndex={-1} className="min-w-0 break-words rounded-ds-control !text-ds-section !text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring">
          {title}
          {count !== undefined && count !== null && count !== '' && <span className="ml-[6px] text-ds-label font-normal text-ds-fg-muted">{count}</span>}
        </h2>
        {tools && <div className="flex flex-wrap items-center gap-[6px]">{tools}</div>}
      </div>
      <div className="p-[16px]">{children}</div>
    </section>
  );
}

/** Which section is being read: the last whose top has passed a line under the sticky bars. The scroll container of the dashboard is <main>. */
export function useSectionSpy(keys: readonly OutlineKey[]): [OutlineKey, (key: OutlineKey) => void] {
  const [current, setCurrent] = useState<OutlineKey>(keys[0]);
  const jumped = useRef<number>(0);
  useEffect(() => {
    const main = document.getElementById('main-content');
    if (!main) return undefined;
    let frame = 0;
    const read = () => {
      frame = 0;
      if (Date.now() - jumped.current < 600) return;                      // a jump is smooth for a moment: the entry that was pressed stays lit
      const top = main.getBoundingClientRect().top;
      const tops = keys.map((key) => ({ key, top: (document.getElementById(`sec-${key}`)?.getBoundingClientRect().top ?? Infinity) - top }));
      const key = sectionInView(tops, 140);
      if (key) setCurrent(key);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(read); };
    main.addEventListener('scroll', onScroll, { passive: true });
    read();
    return () => { main.removeEventListener('scroll', onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, [keys.join(',')]);          // eslint-disable-line react-hooks/exhaustive-deps
  const jump = (key: OutlineKey) => {
    jumped.current = Date.now();
    setCurrent(key);
    const target = document.getElementById(`sec-${key}`);
    target?.scrollIntoView({ block: 'start' });
    document.getElementById(`sec-${key}-h`)?.focus({ preventScroll: true });
  };
  return [keys.includes(current) ? current : keys[0], jump];
}

export function Outline({ order, status, counts, current, onJump, layout }: {
  order: readonly OutlineKey[];
  status: string;
  counts: Partial<Record<OutlineKey, ReactNode>>;
  current: OutlineKey;
  onJump: (key: OutlineKey) => void;
  /** column: the sticky list beside the sections (from 1024px); pills: the row under the bars on a smaller window */
  layout: 'column' | 'pills';
}) {
  const wide = layout === 'column';
  return (
    <nav aria-label="On this page" className={wide ? 'hidden lg:block' : 'lg:hidden'}>
      <ul className={clsx(wide ? 'flex flex-col gap-[2px]' : 'flex gap-[6px] overflow-x-auto px-[2px] py-[6px]')}>
        {order.map((key) => {
          const lit = key === current;
          const count = counts[key];
          return (
            <li key={key} className={wide ? undefined : 'shrink-0'}>
              <a
                href={`#sec-${key}`}
                aria-current={lit ? 'location' : undefined}
                onClick={(e) => { e.preventDefault(); onJump(key); }}
                className={clsx(
                  'flex items-center justify-between gap-[8px] text-ds-body focus-visible:outline-none focus-visible:shadow-ds-ring',
                  wide
                    ? clsx('min-h-ds-control rounded-ds-control border-l-2 px-[10px]', lit ? 'border-ds-primary bg-ds-primary-soft font-[600] text-ds-primary-text' : 'border-transparent text-ds-fg-body hover:bg-ds-surface-hover')
                    : clsx('min-h-ds-control-sm whitespace-nowrap rounded-full border px-[12px]', lit ? 'border-ds-primary bg-ds-primary-soft font-[600] text-ds-primary-text' : 'border-ds-border-strong bg-ds-surface text-ds-fg-body'),
                )}
              >
                <span>{outlineLabel(key, status)}</span>
                {count !== undefined && count !== null && count !== '' && <span className="text-ds-label font-normal text-ds-fg-muted">{count}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
