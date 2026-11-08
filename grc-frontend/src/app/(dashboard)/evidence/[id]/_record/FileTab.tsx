'use client';

// The File & versions tab: the file itself (open it in the viewer, read its text, read it again) and the versions that were kept. The extracted text is read only when its dialog opens.
import { FileText, RefreshCw, ScanText } from 'lucide-react';
import { Button, Fact, FactList, SectionCard, StatusPill } from '@/components/ui/ds';
import { formatDate, formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { ocrStatus as ocrWords } from '@/lib/statuses/evidence';
import { fileKindOf, type Offered } from './recordModel';
import type { EvidenceDetail } from './recordTypes';

const MUTED = 'text-ds-fg-muted';

export function FileTab({ evidence, offered, onOpenFile, onViewText, onReadAgain, reading, nameOf }: {
  evidence: EvidenceDetail;
  offered: Offered;
  onOpenFile: () => void;
  onViewText: () => void;
  onReadAgain: () => void;
  reading: boolean;
  nameOf: (id: number | null | undefined) => string | null;
}) {
  const versions = evidence.versions ?? [];
  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard
        id="the-file" title="The file"
        actions={(
          <>
            {offered.openFile && <Button leftIcon={<FileText aria-hidden />} onClick={onOpenFile}>Open file</Button>}
            {evidence.ocr_status !== 'not_applicable' && <Button leftIcon={<ScanText aria-hidden />} onClick={onViewText}>View text</Button>}
            {offered.readAgain && <Button leftIcon={<RefreshCw aria-hidden />} loading={reading} onClick={onReadAgain}>Read the file again</Button>}
          </>
        )}
      >
        <FactList min={170}>
          <Fact label="File name" empty="No file">{evidence.file_name}</Fact>
          <Fact label="Kind of file">{fileKindOf(evidence.file_name, evidence.file_type)}</Fact>
          <Fact label="Version">{evidence.version ? `v${evidence.version}` : null}</Fact>
          <Fact label="Text"><StatusPill size="sm" {...statusPill(ocrWords, evidence.ocr_status)} /></Fact>
          <Fact label="Text read" empty="Not yet">{evidence.ocr_processed_at ? formatDateTime(evidence.ocr_processed_at) : null}</Fact>
        </FactList>
      </SectionCard>

      <SectionCard id="versions" title="Versions" meta={versions.length ? `${versions.length} kept` : undefined}>
        {versions.length === 0 ? (
          <p className={`text-ds-body ${MUTED}`}>Only the current version of this file is kept.</p>
        ) : (
          <ol className="m-0 list-none p-0">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-x-[12px] gap-y-[2px] border-b border-ds-border py-[8px] first:pt-0 last:border-b-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-ds-body font-[500] text-ds-fg">Version {v.version_number}{v.version_number === evidence.version ? ' · current' : ''}</p>
                  {v.changes && <p className="break-words text-ds-label text-ds-fg-body [overflow-wrap:anywhere]">{v.changes}</p>}
                </div>
                <p className={`text-ds-label ${MUTED}`}>{[formatDate(v.created_at), nameOf(v.created_by)].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    </div>
  );
}
