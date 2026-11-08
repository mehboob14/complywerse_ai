'use client';

// "Upload a file" for a register (KRIs from Excel, incidents from CSV or Excel): the kit's dialog (focus, Escape, a name) instead of the hand-made overlay each page had.
// It sends nothing itself: `run` is the page's request and gives back what to say; the dialog says how it went and tells the page when something was added.
import { useRef, useState } from 'react';
import { Download, FileUp } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
import { Button, Notice } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';

export interface ImportOutcome {
  /** the sentence the server gave */
  message: string;
  /** how many rows were added */
  added: number;
  /** what went wrong row by row (the first ones) */
  errors: string[];
  moreErrors: number;
}

export function ImportDialog({ title, noun, accept, extensions, run, template, onClose, onAdded }: {
  title: string;
  /** "KRIs" */
  noun: string;
  /** the input's accept list: ".csv,.xlsx,.xls" */
  accept: string;
  /** the same list as a test on a dropped file's name */
  extensions: RegExp;
  run: (file: File) => Promise<ImportOutcome>;
  template?: () => Promise<unknown>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [templateFailed, setTemplateFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    setOutcome(null);
    setFailure(null);
    setFile(extensions.test(f.name) ? f : null);
    if (!extensions.test(f.name)) setFailure(`That file type is not accepted. Choose ${accept.split(',').join(', ')}.`);
  };
  const upload = async () => {
    if (!file || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const done = await run(file);
      setOutcome(done);
      if (done.added > 0) onAdded();
    } catch (e) {
      setFailure(errorMessage(e, 'The file could not be uploaded.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="md"
      title={title}
      subtitle={`A file of ${noun}, one per row`}
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>{outcome ? 'Done' : 'Cancel'}</Button>
          <Button variant="primary" leftIcon={<FileUp aria-hidden />} loading={busy} disabled={!file || !!outcome} onClick={() => { void upload(); }}>Upload</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[12px] px-[20px] py-[16px]">
        {template && (
          <div>
            <Button leftIcon={<Download aria-hidden />} onClick={() => { setTemplateFailed(false); template().catch(() => setTemplateFailed(true)); }}>Download the template</Button>
            {templateFailed && <p role="alert" className="mt-[6px] text-ds-label text-ds-danger">The template could not be downloaded. Try again.</p>}
          </div>
        )}
        <div className="flex flex-col items-start gap-[8px] rounded-ds-card border border-dashed border-ds-border-strong bg-ds-surface-subtle px-[16px] py-[16px]">
          <p className="text-ds-body text-ds-fg-body">{file ? <>Chosen: <span className="font-[600] text-ds-fg [overflow-wrap:anywhere]">{file.name}</span></> : `Choose a file (${accept.split(',').join(', ')}).`}</p>
          <input ref={input} type="file" accept={accept} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files?.[0])} />
          <Button onClick={() => input.current?.click()}>{file ? 'Choose another file' : 'Choose a file'}</Button>
        </div>
        {failure && <Notice tone="danger" title="Not uploaded">{failure}</Notice>}
        {outcome && (
          <Notice tone={outcome.added > 0 ? 'info' : 'warning'} title={outcome.message}>
            {outcome.errors.length > 0 && (
              <ul className="m-0 list-disc pl-[18px]">
                {outcome.errors.map((e, i) => <li key={i} className="text-ds-body">{e}</li>)}
                {outcome.moreErrors > 0 && <li className="text-ds-body">{`and ${outcome.moreErrors} more`}</li>}
              </ul>
            )}
          </Notice>
        )}
      </div>
    </AnimatedModal>
  );
}
