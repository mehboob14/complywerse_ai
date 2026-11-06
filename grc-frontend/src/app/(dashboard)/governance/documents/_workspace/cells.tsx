'use client';

/**
 * The two cells of the library's list that are shared pieces rather than the page's own (libraryRows.tsx lays the row out): the tile of the kind of file a document carries, beside its
 * title, and the status as a pill with the card of the document's life cycle. Written on the design-system tokens (only --ds colours, 12px at the least); a status is a StatusPill from
 * the document registry (lib/status.ts).
 */
import type { CSSProperties } from 'react';
import { File as FileIcon, FileSpreadsheet, FileText, FileType, Presentation, type LucideIcon } from 'lucide-react';
import { StatusPill } from '@/components/ui/ds';
import { TONE, documentStatus, statusPill } from '@/lib/status';
import type { GovDoc } from './lib';
import { LifecycleHover } from './LifecycleHover';
import { fileKind, type FileKind } from './libraryFormat';

const TILES: Record<FileKind | 'none', { Icon: LucideIcon; tone: keyof typeof TONE | 'platform'; label: string }> = {
  pdf: { Icon: FileText, tone: 'danger', label: 'PDF file' },
  word: { Icon: FileType, tone: 'progress', label: 'Word file' },
  excel: { Icon: FileSpreadsheet, tone: 'success', label: 'Excel file' },
  powerpoint: { Icon: Presentation, tone: 'warning', label: 'PowerPoint file' },
  text: { Icon: FileText, tone: 'neutral', label: 'Text file' },
  other: { Icon: FileIcon, tone: 'neutral', label: 'File' },
  none: { Icon: FileText, tone: 'platform', label: 'Written in the platform' },
};
const tileStyle = (tone: keyof typeof TONE | 'platform'): CSSProperties =>
  tone === 'platform' ? { background: 'var(--ds-primary-soft)', color: 'var(--ds-primary-text)' } : { background: TONE[tone].tint, color: TONE[tone].text };

/** The kind of file the document carries, as a tile; a document written on the platform has none and gets the teal one. */
export function FileTile({ doc, compact }: { doc: GovDoc; compact: boolean }) {
  const { Icon, tone, label } = TILES[fileKind(doc) ?? 'none'];
  return (
    <span role="img" aria-label={label} title={label} style={tileStyle(tone)} className={`inline-flex shrink-0 items-center justify-center rounded-ds-card ${compact ? 'h-[24px] w-[24px]' : 'h-[32px] w-[32px]'}`}>
      <Icon className="h-[16px] w-[16px]" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/** The status as its pill (the library's own words are registered in lib/status.ts); where the card of the document's life cycle opens on hover or focus. */
export function LifecycleCell({ doc }: { doc: GovDoc }) {
  return (
    <LifecycleHover doc={doc} focusable>
      <span className="inline-flex max-w-full py-[2px]"><StatusPill size="sm" {...statusPill(documentStatus, doc.status)} /></span>
    </LifecycleHover>
  );
}
