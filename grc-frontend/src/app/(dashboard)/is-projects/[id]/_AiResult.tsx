'use client';

// What the AI suggested, for the person to read and apply or discard. It is the kit's AnimatedModal (focus moves in, Escape closes, focus returns), so the old
// hand-made overlay with no keyboard handling is gone. The content is still the suggestion as the server sent it (the five AI answers have five shapes); a nicer
// rendering of each is its own piece of design. Apply is a reported mutation (the page's): it says what it did, or why it could not, and never leaves the person
// guessing what was half-created.
import { CheckCircle2 } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
import { Button } from '@/components/ui/ds';

export function AiResultDialog({ title, data, canApply, applying, onApply, onClose }: { title: string; data: unknown; canApply: boolean; applying: boolean; onApply: () => void; onClose: () => void }) {
  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      title={title}
      size="lg"
      footer={canApply ? (
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose} disabled={applying}>Discard</Button>
          <Button variant="primary" leftIcon={<CheckCircle2 aria-hidden />} loading={applying} onClick={onApply}>Apply to project</Button>
        </div>
      ) : undefined}
    >
      <div className="px-[20px] py-[16px]">
        <pre className="whitespace-pre-wrap font-sans text-ds-body leading-[20px] text-ds-fg-body [overflow-wrap:anywhere]">{JSON.stringify(data, null, 2)}</pre>
      </div>
    </AnimatedModal>
  );
}
