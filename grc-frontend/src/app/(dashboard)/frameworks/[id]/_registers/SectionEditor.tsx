'use client';

// The open section of a framework document: its heading and where it stands, the text tools (bold, italic, bullets, link), the AI draft of this section,
// the text or, for a table section, the table with its own rows; and the word count with a warning while a [placeholder] is still in the text.
import { useRef } from 'react';
import { AlertTriangle, Bold, Italic, Link2, List, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button, IconButton, Select, Table, TableFrame, TBody, Td, TextInput, Textarea, Th, THead, Tr } from '@/components/ui/ds';
import { documentSectionState } from '@/lib/statuses/frameworkRegisters';
import {
  bulletLines, hasPlaceholder, sectionState, wordCount, wrapSelection,
  type DocSection, type SectionWord, type TextEdit,
} from './documentModel';

interface Props {
  index: number;
  section: DocSection;
  /** the line under the heading: the framework and the clause */
  reference: string;
  onPatch: (patch: Partial<DocSection>) => void;
  onCell: (row: number, col: number, value: string) => void;
  onAddRow: () => void;
  onRemoveRow: (row: number) => void;
  onRemoveSection: () => void;
  onAi: () => void;
  aiBusy: boolean;
  aiDisabled: boolean;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
}

const WORDS: SectionWord[] = ['to_start', 'draft', 'ready'];

export default function SectionEditor({ index, section, reference, onPatch, onCell, onAddRow, onRemoveRow, onRemoveSection, onAi, aiBusy, aiDisabled, onSave, saving, dirty }: Props) {
  const body = useRef<HTMLTextAreaElement>(null);
  const table = section.table;
  const words = wordCount(section.body);

  // run a text tool on the selection, then put the selection back on what it changed
  const tool = (change: (text: string, start: number, end: number) => TextEdit) => {
    const ta = body.current;
    if (!ta) return;
    const edit = change(ta.value, ta.selectionStart, ta.selectionEnd);
    onPatch({ body: edit.text });
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(edit.selStart, edit.selEnd); });
  };

  return (
    <section aria-label={`Section ${index + 1}`} className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
      <div className="flex flex-wrap items-start gap-[8px]">
        <span aria-hidden className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-ds-control bg-ds-primary text-ds-body font-medium text-ds-on-primary">{index + 1}</span>
        <div className="min-w-0 flex-1 basis-[200px]">
          <TextInput aria-label="Section heading" value={section.heading} onChange={(e) => onPatch({ heading: e.target.value })} placeholder="Section heading" />
          {reference && <p className="mt-[2px] text-ds-label text-ds-fg-muted">{reference}</p>}
        </div>
        <Select aria-label="Where this section stands" value={sectionState(section)} onChange={(e) => onPatch({ status: e.target.value as SectionWord })} className="w-[130px]">
          {WORDS.map((w) => <option key={w} value={w}>{documentSectionState.label(w)}</option>)}
        </Select>
        <IconButton label="Remove this section" onClick={onRemoveSection}><Trash2 /></IconButton>
      </div>

      <div className="mt-[12px] overflow-hidden rounded-ds-control border border-ds-border-control">
        <div className="flex flex-wrap items-center gap-[4px] border-b border-ds-border bg-ds-surface-subtle px-[8px] py-[4px]">
          <IconButton label="Bold" disabled={!!table} onClick={() => tool((t, s, e) => wrapSelection(t, s, e, '**', '**'))}><Bold /></IconButton>
          <IconButton label="Italic" disabled={!!table} onClick={() => tool((t, s, e) => wrapSelection(t, s, e, '*', '*'))}><Italic /></IconButton>
          <IconButton label="Bullet list" disabled={!!table} onClick={() => tool((t, s, e) => bulletLines(t, s, e))}><List /></IconButton>
          <IconButton label="Link" disabled={!!table} onClick={() => tool((t, s, e) => wrapSelection(t, s, e, '[', '](https://)'))}><Link2 /></IconButton>
          <Button size="sm" className="ml-auto" leftIcon={<Sparkles aria-hidden />} loading={aiBusy} disabled={aiDisabled || !!table} onClick={onAi}>AI draft this section</Button>
        </div>

        {table ? (
          <div>
            <TableFrame aria-label={`${section.heading}: table`}>
              <Table caption={`${section.heading}: table`}>
                <THead>
                  <Tr>
                    {table.columns.map((c, ci) => <Th key={ci}>{c}</Th>)}
                    <Th align="right"><span className="sr-only">Remove row</span></Th>
                  </Tr>
                </THead>
                <TBody>
                  {table.rows.map((row, ri) => (
                    <Tr key={ri}>
                      {row.map((cell, ci) => (
                        <Td key={ci}><TextInput aria-label={`${table.columns[ci] ?? 'Cell'}, row ${ri + 1}`} value={cell} onChange={(e) => onCell(ri, ci, e.target.value)} /></Td>
                      ))}
                      <Td align="right"><IconButton label={`Remove row ${ri + 1}`} onClick={() => onRemoveRow(ri)}><Trash2 /></IconButton></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableFrame>
            <div className="border-t border-ds-border px-[8px] py-[6px]">
              <Button size="sm" variant="ghost" leftIcon={<Plus aria-hidden />} onClick={onAddRow}>Add row</Button>
            </div>
          </div>
        ) : (
          <Textarea
            ref={body}
            aria-label={`${section.heading || 'Section'}: text`}
            rows={Math.max(8, section.body.split('\n').length + 1)}
            value={section.body}
            onChange={(e) => onPatch({ body: e.target.value })}
            placeholder="Write this section"
            className="[&_textarea]:rounded-none [&_textarea]:border-0"
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-[8px] border-t border-ds-border bg-ds-surface-subtle px-[12px] py-[6px]">
          <p className="flex flex-wrap items-center gap-x-[12px] gap-y-[2px] text-ds-label text-ds-fg-muted">
            <span>{words} {words === 1 ? 'word' : 'words'}</span>
            {hasPlaceholder(section.body) && (
              <span className="inline-flex items-center gap-[4px] text-ds-warning">
                <AlertTriangle aria-hidden className="h-[14px] w-[14px]" /> Contains a [placeholder]. Replace it before review.
              </span>
            )}
          </p>
          <Button variant={dirty ? 'primary' : 'secondary'} size="sm" loading={saving} disabled={!dirty} onClick={onSave}>Save</Button>
        </div>
      </div>
    </section>
  );
}
