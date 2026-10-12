'use client';

import { useEffect, useState } from 'react';
import { Loader2, PenLine } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
import SignaturePad from './SignaturePad';

/** Sign a document from a list: draw the signature, add an optional comment, sign. */
export default function SignDialog({
  open, title, stage, busy, onClose, onSign,
}: {
  open: boolean;
  title: string;
  stage?: string;
  busy?: boolean;
  onClose: () => void;
  onSign: (signature: string, comment: string) => void;
}) {
  const [signature, setSignature] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  useEffect(() => { if (!open) setComment(''); }, [open]);
  return (
    <AnimatedModal isOpen={open} onClose={onClose} size="md" title="Sign this document" subtitle={title}>
      <div className="space-y-3 p-1">
        <p className="text-sm text-slate-600">
          Draw your signature{stage ? ` to sign as “${stage}”` : ''}. It is kept with this sign-off with your name, the time, your IP address and a
          fingerprint (hash) of the document, and added to the audit trail.
        </p>
        <SignaturePad onChange={setSignature} />
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Optional comment…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" disabled={!signature || busy} onClick={() => signature && onSign(signature, comment)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Sign
          </button>
        </div>
      </div>
    </AnimatedModal>
  );
}
