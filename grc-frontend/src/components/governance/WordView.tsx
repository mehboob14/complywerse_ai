'use client';

/**
 * A Word document drawn as Word draws it (docx-preview): its own numbering (1.3.1.1, I., a.), headings, tables in place,
 * headers and footers, fonts, pictures and page breaks. It is rendered inside a shadow root so the platform's CSS cannot
 * change it, and scaled down to fit the width it is given (never up). The library loads only when a Word file is shown.
 */
import { useEffect, useRef, useState } from 'react';
import { FileWarning, Loader2 } from 'lucide-react';

const OPTIONS = {
  className: 'docx',
  inWrapper: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  renderChanges: false,
  useBase64URL: true,
  experimental: true,
};

const FRAME = `
  :host { display: block; }
  .docx-wrapper { background: #e8ecf0 !important; padding: 20px 0 !important; }
  .docx-wrapper > section.docx { box-shadow: 0 1px 4px rgba(15, 23, 42, .18); margin-bottom: 20px !important; }
`;

export default function WordView({ file, height, label = 'Document' }: {
  /** the .docx file to draw (null while it is being fetched) */
  file: Blob | null;
  /** a fixed height (a preview); the whole document otherwise */
  height?: number | string;
  label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    const el = host.current;
    if (!el || !file) return;
    let cancelled = false;
    setState('loading');
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${FRAME}</style><div data-styles></div><div data-body></div>`;
    const styles = root.querySelector('[data-styles]') as HTMLElement;
    const body = root.querySelector('[data-body]') as HTMLElement;
    const fit = () => {
      const page = body.querySelector('section.docx') as HTMLElement | null;
      if (!page) return;
      const scale = Math.min(1, (el.clientWidth - 8) / (page.offsetWidth + 2));
      (body.style as CSSStyleDeclaration & { zoom: string }).zoom = scale > 0 ? String(scale) : '1';
    };
    const resize = new ResizeObserver(fit);
    import('docx-preview')
      .then(({ renderAsync }) => renderAsync(file, body, styles, OPTIONS))
      .then(() => {
        if (cancelled) return;
        fit();
        resize.observe(el);
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('failed'); });
    return () => { cancelled = true; resize.disconnect(); };
  }, [file]);

  return (
    <div className="relative" style={height != null ? { height, overflow: 'hidden' } : undefined}>
      <div ref={host} role="document" aria-label={label} className="w-full overflow-x-auto" />
      {(state === 'loading' || !file) && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70">
          <Loader2 className="h-6 w-6 animate-spin text-[#0f766e]" aria-label="Loading the document" />
        </div>
      )}
      {state === 'failed' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white text-sm text-[#586472]" role="alert">
          <FileWarning className="h-8 w-8" aria-hidden />
          This Word file could not be drawn here. Download it to open it in Word.
        </div>
      )}
    </div>
  );
}
