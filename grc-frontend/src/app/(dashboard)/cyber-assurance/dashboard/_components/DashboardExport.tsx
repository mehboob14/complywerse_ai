'use client';

/**
 * "Export PDF" for the Performance dashboard — print-optimised CSS + window.print().
 *
 * No dependency and no server round-trip: the button opens the browser's print dialog, where
 * "Save as PDF" produces a vector PDF (selectable text, crisp charts). Because the print rules
 * are plain `@media print` CSS, Ctrl/Cmd+P on the page produces the identical output.
 *
 * Place <DashboardExport /> INSIDE the page root (the element carrying `data-exec-dash`),
 * e.g. beside the "Refresh now" button. What the print stylesheet does:
 *   - prints only the dashboard: the sidebar, top bar, panels and toasts are hidden, and the app
 *     shell (h-screen + overflow clip) is un-clipped so the page paginates instead of cutting off
 *     at one screenful;
 *   - landscape, 8 mm margins; background colours / chart fills are forced on;
 *   - hides interactive chrome (buttons, the auto-refresh picker, "view as table", card links);
 *   - keeps every card whole across page breaks;
 *   - mirrors the screen's ≥1280px (xl) grid — a landscape A4 page is only ~1060px wide, so
 *     Tailwind's xl: rules would never match in print;
 *   - adds a print-only title block ("Generated <time>") and names the PDF after the date.
 * The export is deliberately unbranded (no logo).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDown } from 'lucide-react';
import { FONT, T } from './kit';

const ROOT = '[data-exec-dash]';

const PRINT_CSS = String.raw`
@page { size: landscape; margin: 8mm; }

[data-exec-print-head] { display: none; }

@media print {
  /* 1. Only the dashboard prints — hide everything that is neither the root, inside it, nor an ancestor of it. */
  body *:not(:has(${ROOT})):not(${ROOT}):not(${ROOT} *) { display: none !important; }

  /* 2. Ancestors (the app shell: h-screen, overflow clip, flex) must flow as plain blocks so the page paginates. */
  html:has(${ROOT}), body:has(${ROOT}), body *:has(${ROOT}) {
    display: block !important; position: static !important; float: none !important;
    width: auto !important; height: auto !important; min-height: 0 !important; max-height: none !important;
    overflow: visible !important; margin: 0 !important; padding: 0 !important; border: 0 !important;
    transform: none !important; background: #fff !important;
  }

  /* 3. The dashboard: full width, exact colours, no shadows. */
  ${ROOT} { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
  ${ROOT}, ${ROOT} * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-shadow: none !important; }
  [data-exec-print-head] { display: block; margin: 0 0 2px; }

  /* 4. Interactive chrome has no place on paper. */
  ${ROOT} button,
  ${ROOT} select,
  ${ROOT} label:has(select),
  ${ROOT} details,
  ${ROOT} section > div:first-child > a,
  ${ROOT} nav > a > svg { display: none !important; }

  /* 5. Never split a card or a KPI tile across pages. */
  ${ROOT} section, ${ROOT} nav > a { break-inside: avoid; page-break-inside: avoid; }

  /* 6. Mirror the screen's xl (>=1280px) grid; the print page is narrower, so Tailwind's xl: rules never match. */
  ${ROOT} .xl\:grid-cols-12 { grid-template-columns: repeat(12, minmax(0, 1fr)); }
  ${ROOT} .xl\:grid-cols-7 { grid-template-columns: repeat(7, minmax(0, 1fr)); }
  ${ROOT} .xl\:grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  ${ROOT} [class*="xl:grid-cols-[minmax"] { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr); }
  ${ROOT} .xl\:col-span-12 { grid-column: span 12 / span 12; }
  ${ROOT} .xl\:col-span-8 { grid-column: span 8 / span 8; }
  ${ROOT} .xl\:col-span-7 { grid-column: span 7 / span 7; }
  ${ROOT} .xl\:col-span-6 { grid-column: span 6 / span 6; }
  ${ROOT} .xl\:col-span-5 { grid-column: span 5 / span 5; }
  ${ROOT} .xl\:col-span-4 { grid-column: span 4 / span 4; }
}
`;

export function DashboardExport({ busy = false, title = 'Performance — executive cyber posture', className = '' }: {
  /** true while the page is still loading / refreshing — printing then would capture skeletons */
  busy?: boolean;
  /** heading of the print-only title block; also names the saved PDF */
  title?: string;
  className?: string;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const stamp = useRef<HTMLSpanElement>(null);
  const [head, setHead] = useState<HTMLElement | null>(null);

  // Print-only title block: a host node prepended to the dashboard root, filled via a portal.
  useEffect(() => {
    const root = btn.current?.closest<HTMLElement>(ROOT);
    if (!root) return;
    const el = document.createElement('div');
    el.setAttribute('data-exec-print-head', '');
    root.insertBefore(el, root.firstChild);
    setHead(el);
    return () => { el.remove(); setHead(null); };
  }, []);

  // beforeprint fires for the button AND Ctrl/Cmd+P: stamp the time and name the PDF after the date.
  useEffect(() => {
    let saved: string | null = null;
    const before = () => {
      const now = new Date();
      if (stamp.current) stamp.current.textContent = now.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      saved = document.title;
      document.title = `${title} — ${now.toISOString().slice(0, 10)}`;
    };
    const after = () => { if (saved != null) document.title = saved; saved = null; };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); after(); };
  }, [title]);

  const print = () => { try { window.print(); } catch { /* print blocked (sandboxed frame) — nothing to do */ } };

  return (
    <>
      {/* dangerouslySetInnerHTML: React's SSR escapes > and " inside <style> children, which would break the selectors */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <button ref={btn} type="button" onClick={print} disabled={busy} aria-label="Export dashboard to PDF"
        title={busy ? 'Waiting for the dashboard to finish loading…' : 'Opens the print dialog — choose “Save as PDF” to export this dashboard'}
        className={`inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#E2E5EC] bg-white px-3 text-[12px] font-semibold text-[#334155] hover:bg-[#F6F7FB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#005B96] disabled:cursor-default disabled:opacity-70 ${className}`}>
        <FileDown size={13} aria-hidden style={{ color: T.base }} />Export PDF
      </button>
      {head && createPortal(
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, borderBottom: `2px solid ${T.base}`, paddingBottom: 6, fontFamily: FONT }}>
          <div>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 600, color: T.text }}>{title}</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: T.muted }}>Live data across every cyber module</p>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: T.muted }}>Generated <span ref={stamp} /></p>
        </div>,
        head,
      )}
    </>
  );
}
