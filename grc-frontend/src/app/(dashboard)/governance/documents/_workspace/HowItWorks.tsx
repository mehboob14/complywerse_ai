'use client';

// "How it works": the side sheet of the Documents library's plain-English layer. The six steps a document goes through (the Tracker's own steps), who does each, what each label on a card
// means, and the seven words the library uses with their plain meaning (glossary.ts; the same meanings the (i) notes say). It is the one place the explanations live besides those (i)
// notes: the library prints no introduction. A sheet from the right on a desktop, a bottom sheet on a phone (the kit's Sheet: focus trapped, Escape closes it, focus goes back).
//   <HowItWorksButton />                       a button that opens it (the Tracker's toolbar)
//   <HowItWorks open={open} onClose={close} />  the sheet itself, when the page holds its state
import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Button, Sheet } from '@/components/ui/ds';
import { GLOSSARY, HOW_STEPS, TERM_KEYS } from './glossary';
import { BADGE_MEANING } from './libraryTracker';

const HEAD = 'm-0 !text-ds-section !font-[600] !text-ds-fg';

export function HowItWorks({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="How it works" width="md">
      {/* focusable, so a keyboard can scroll the sheet's body (a scrolling region with nothing to focus cannot be reached) */}
      <div tabIndex={0} role="region" aria-label="How it works" className="flex flex-col gap-[24px] rounded-ds-control focus-visible:outline-none focus-visible:shadow-ds-ring">
        <section aria-labelledby="how-steps">
          <h3 id="how-steps" className={HEAD}>Six steps</h3>
          <ol className="m-0 mt-[12px] flex list-none flex-col gap-[14px] p-0">
            {HOW_STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-[12px]">
                <span aria-hidden className="grid h-[28px] w-[28px] place-items-center rounded-full bg-ds-primary-soft text-ds-label font-[600] text-ds-primary-text">{i + 1}</span>
                <div className="min-w-0">
                  <h4 className="m-0 !text-ds-body !font-[600] !text-ds-fg"><span className="sr-only">{`Step ${i + 1}: `}</span>{s.title}</h4>
                  <p className="m-0 mt-[2px] text-ds-body text-ds-fg-body">{s.text}</p>
                  <p className="m-0 mt-[2px] text-ds-label text-ds-fg-muted">{`Who: ${s.who}`}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="how-labels">
          <h3 id="how-labels" className={HEAD}>Labels</h3>
          <dl className="m-0 mt-[8px] flex flex-col">
            {BADGE_MEANING.map((b) => (
              <div key={b.word} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-[12px] border-t border-ds-border py-[8px] first:border-t-0">
                <dt className="text-ds-body font-[600] text-ds-fg">{b.word}</dt>
                <dd className="m-0 text-ds-body text-ds-fg-body">{b.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="how-words">
          <h3 id="how-words" className={HEAD}>Words</h3>
          <dl className="m-0 mt-[8px] flex flex-col">
            {TERM_KEYS.map((k) => (
              <div key={k} className="border-t border-ds-border py-[8px] first:border-t-0">
                <dt className="text-ds-body font-[600] text-ds-fg">{GLOSSARY[k].word}</dt>
                <dd className="m-0 mt-[2px] text-ds-body text-ds-fg-body">{GLOSSARY[k].plain}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Sheet>
  );
}

/** A button that opens the sheet and keeps its own state. */
export function HowItWorksButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" leftIcon={<HelpCircle aria-hidden />} onClick={() => setOpen(true)} className={className}>How it works</Button>
      <HowItWorks open={open} onClose={() => setOpen(false)} />
    </>
  );
}
