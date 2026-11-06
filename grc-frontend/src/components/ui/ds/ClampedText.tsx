'use client';

// ClampedText: a long text as a few lines, with "Show more" only when it really is cut. The whole text stays in the page (it is clamped by CSS, so a screen
// reader reads all of it and find-in-page finds it); "Show more" is a real button with `aria-expanded` and `aria-controls`, so the whole value is one keyboard
// press away. Whether it is cut is MEASURED (the lines depend on the width): a text that fits draws no button, a window that grows takes a button away.
// Line breaks are kept; the text is read in its own direction (Arabic beside English). A missing text is the dash. Rules: clampModel.ts.
//
//   <ClampedText text={requirement.description} lines={4} />
import { useId, useState } from 'react';
import { clsx } from 'clsx';
import { orEmpty } from '@/lib/format';
import { Button } from './Button';
import { CLAMP_CLASS, clampLines, showsToggle, toggleWords } from './clampModel';
import { useLineClamped } from './useLineClamped';

export interface ClampedTextProps {
  /** The text; line breaks are kept. Missing or blank: a dash. */
  text: string | null | undefined;
  /** Lines shown while it is shut, 1 to 6. */
  lines?: number;
  /** Layout only (margin, width). */
  className?: string;
}

export function ClampedText({ text, lines, className }: ClampedTextProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [box, cut] = useLineClamped<HTMLParagraphElement>(!open);                    // open: the clamp is lifted, keep what was measured
  const words = orEmpty(text);
  return (
    <div className={className}>
      <p ref={box} id={id} dir="auto" className={clsx('whitespace-pre-line break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]', !open && CLAMP_CLASS[clampLines(lines)])}>{words}</p>
      {showsToggle({ cut, open }) && (
        <Button variant="link" size="sm" className="-ml-[8px] mt-[2px]" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{toggleWords(open)}</Button>
      )}
    </div>
  );
}
