'use client';

/**
 * The document as its file shows it. A Word file edited in place is the file itself with the changes written in, drawn as
 * Word draws it (its numbering, fonts, tables, header and footer), and it follows each saved revision. A PDF is shown as it
 * was uploaded: it cannot be edited, so the changes are in the text, and saving makes a Word copy of it.
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import WordView from '@/components/governance/WordView';
import { InfoTip } from '@/components/ui/InfoTip';
import { problemOfBlob, studioApi, type Session } from '@/lib/studio/api';
import { fileNote } from './viewSwitch';

export default function FileView({ session, maySave }: { session: Session; maySave: boolean }) {
  const word = !!session.source?.in_place;
  const [file, setFile] = useState<Blob | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = word ? session.revision : 0;                 // a PDF does not change with the text

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setError(null);
    (word ? studioApi.exportFile(session.id, { format: 'docx' }).then((r) => r.blob) : studioApi.sourceFile(session.id))
      .then((blob) => {
        if (cancelled) return;
        if (word) setFile(blob);
        else { url = URL.createObjectURL(blob); setPdfUrl(url); }
      })
      .catch(async (e) => { const why = await problemOfBlob(e); if (!cancelled) setError(why); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [session.id, word, revision]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#e8ecf0]">
      <p className="flex shrink-0 items-center gap-1 border-b border-[#d5dbe1] bg-[#fff] px-3 py-1.5 text-xs font-medium text-[#3f4b58]">
        {word ? 'Word layout' : 'Original PDF'}
        <InfoTip label="About this view" text={fileNote(session.source, maySave)} />
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error ? (
          <p role="alert" className="rounded-lg border border-[#f1b5b5] bg-[#fdf3f3] p-4 text-sm text-[#8a1c1c]">{error}</p>
        ) : word ? (
          <WordView file={file} label={session.title} />
        ) : pdfUrl ? (
          <iframe src={pdfUrl} title={`${session.title} (PDF)`} className="h-full min-h-[70vh] w-full rounded border border-[#d5dbe1] bg-white" />
        ) : (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#0f766e]" aria-label="Loading the PDF" /></div>
        )}
      </div>
    </div>
  );
}
