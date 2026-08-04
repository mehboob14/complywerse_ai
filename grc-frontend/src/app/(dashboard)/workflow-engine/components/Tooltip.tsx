'use client';

import { useState, useRef, useCallback } from 'react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  disabled?: boolean;
}

export function Tooltip({ content, children, disabled }: TooltipProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const show = useCallback(() => {
    if (!content || disabled) return;
    timerRef.current = setTimeout(() => {
      if (containerRef.current) {
        setRect(containerRef.current.getBoundingClientRect());
      }
    }, 350);
  }, [content, disabled]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setRect(null);
  }, []);

  return (
    <div ref={containerRef} onMouseEnter={show} onMouseLeave={hide} className="relative w-full">
      {children}
      {rect && content && (
        <div
          style={{
            position: 'fixed',
            left: rect.right + 10,
            top: rect.top + rect.height / 2,
            transform: 'translateY(-50%)',
            zIndex: 9999,
            pointerEvents: 'none',
          }}
          className="w-56 rounded-lg bg-gray-900 text-white shadow-2xl text-[11px] leading-relaxed overflow-hidden"
        >
          {/* Arrow pointing left */}
          <div
            className="absolute right-full top-1/2 -translate-y-1/2"
            style={{
              width: 0, height: 0,
              borderTop: '5px solid transparent',
              borderBottom: '5px solid transparent',
              borderRight: '6px solid #111827',
            }}
          />
          <div className="px-3 py-2.5">{content}</div>
        </div>
      )}
    </div>
  );
}
