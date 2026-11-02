'use client';

// The link address of the rich-text editors (the AI Studio's and the library's), asked in a dialog instead of window.prompt: it names itself, keeps
// focus inside, returns it to the toolbar button, and asks "Discard changes?" before a typed address is thrown away. The result is the browser
// prompt's: an address is linked to the selected text, and a link under the cursor can be taken off (that was an empty answer to the prompt, which
// is now its own button). What counts as an address is _linkAddress.ts.
import { useId, useRef, useState, type FormEvent } from 'react';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, FormField, TextInput } from '@/components/ui/ds';
import { addressToLink, startingAddress } from './_linkAddress';

export function LinkDialog({ previous, onApply, onRemove, onClose }: {
  /** the address of the link under the cursor, when there is one: the field starts with it and the dialog offers to take it off */
  previous?: string | null;
  onApply: (href: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const start = startingAddress(previous);
  const form = useId();
  const [address, setAddress] = useState(start);
  const [tried, setTried] = useState(false);                         // the error shows once an empty address was sent, not while the person types
  const selected = useRef(false);                                    // the offered text is selected when the field first takes focus, as in the prompt
  const href = addressToLink(address);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (href === null) setTried(true);
    else onApply(href);
  };
  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="md"
      title="Link address"
      dirty={address !== start}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          {previous ? <Button variant="dangerOutline" className="mr-auto" onClick={onRemove}>Remove link</Button> : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={form}>Apply link</Button>
        </div>
      )}
    >
      <form id={form} onSubmit={submit} noValidate className="px-[20px] py-[16px]">
        <FormField label="Address" error={tried && href === null ? 'Enter the address to link to.' : undefined}>
          <TextInput
            value={address}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => { if (!selected.current) { selected.current = true; e.currentTarget.select(); } }}
          />
        </FormField>
      </form>
    </AnimatedModal>
  );
}
