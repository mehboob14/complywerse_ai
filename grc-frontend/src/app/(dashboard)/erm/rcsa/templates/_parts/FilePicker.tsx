'use client';

// A file field in the kit's look (the kit has no file input yet): the browser's own picker, styled with the tokens, wired to the FormField around it. It shows the chosen file's name and
// size, and a picked file can be taken back. `accept` limits what the picker offers; the server still checks what arrives.
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton, useFieldControl } from '@/components/ui/ds';
import { sizeText } from '@/lib/rcsa/registerModel';

export function FilePicker({ file, onChange, accept, disabled = false }: { file: File | null; onChange: (file: File | null) => void; accept?: string; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const a11y = useFieldControl();
  // the file was taken back from outside (a form that was sent or cleared): the browser's own field forgets it too
  useEffect(() => { if (!file && input.current) input.current.value = ''; }, [file]);
  return (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <input
        ref={input}
        type="file"
        accept={accept}
        disabled={disabled}
        {...a11y}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="block w-full min-w-0 cursor-pointer text-ds-body text-ds-fg file:mr-[12px] file:min-h-ds-control file:cursor-pointer file:rounded-ds-control file:border file:border-ds-border-strong file:bg-ds-surface file:px-[12px] file:text-ds-label file:font-[500] file:text-ds-fg hover:file:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
      />
      {file && (
        <div className="flex min-w-0 items-center gap-[8px] text-ds-label text-ds-fg-muted">
          <span className="min-w-0 truncate" title={file.name}>{file.name}</span>
          <span className="shrink-0">{sizeText(file.size)}</span>
          <IconButton label="Remove the chosen file" onClick={() => { onChange(null); if (input.current) input.current.value = ''; }}><X aria-hidden /></IconButton>
        </div>
      )}
    </div>
  );
}
