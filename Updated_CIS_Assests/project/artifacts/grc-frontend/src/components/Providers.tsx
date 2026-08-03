'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ToastProvider } from './ui/ToastProvider';

const AI_TEXT_RE = /\bAI\b|generate|suggest|draft|assess|analyz|processing|reasoning/i;
const BUSY_TEXT_RE = /generating|analyzing|assessing|drafting|processing|thinking|loading/i;

function applyGlobalAIUX(root: ParentNode = document) {
  const interactive = root.querySelectorAll<HTMLElement>('button, a, [role="button"]');

  interactive.forEach((el) => {
    const text = (el.textContent || '').trim();
    const hasSparkles = !!el.querySelector('.lucide-sparkles');
    const hasLoader = !!el.querySelector('.lucide-loader-2.animate-spin');
    const hasAIDataFlag = el.hasAttribute('data-ai-action');

    const isAIAction = hasAIDataFlag || hasSparkles || AI_TEXT_RE.test(text);
    if (isAIAction) {
      el.classList.add('grc-ai-action');
    } else {
      el.classList.remove('grc-ai-action');
    }

    const isBusy =
      hasLoader ||
      el.getAttribute('aria-busy') === 'true' ||
      ((el as HTMLButtonElement).disabled && BUSY_TEXT_RE.test(text));

    if (isAIAction && isBusy) {
      el.classList.add('is-generating');
    } else {
      el.classList.remove('is-generating');
    }
  });
}

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  useEffect(() => {
    applyGlobalAIUX(document);

    let rafId: number | null = null;
    const scheduleApply = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        applyGlobalAIUX(document);
        rafId = null;
      });
    };

    const observer = new MutationObserver(() => {
      scheduleApply();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'disabled', 'aria-busy'],
    });

    return () => {
      observer.disconnect();
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {children}
      </ToastProvider>
    </QueryClientProvider>
  );
}
