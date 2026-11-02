'use client';

// The record tabs of a project: Risks & Issues and Status Updates (cards: they hold paragraphs), Documents and Lessons Learned (registers). Severity and impact are the
// platform's priority words, status and health are pills with their word; "Identified", "Added" and an update's date are moments in the viewer's own zone. A risk's status
// is changed in place (saved when chosen, said by the page, put back if refused); every Delete asks first. The platform Issues linked to the project are the shared panel.
import { AlertTriangle, BookOpen, Download, ExternalLink, FileText, MessageSquare, Plus } from 'lucide-react';
import { RelatedIssuesPanel } from '@/components/issue-management/RelatedIssuesPanel';
import { Button, EmptyState, FormField, PersonChip, RegisterTable, SectionCard, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { EMPTY, formatCount, formatDate } from '@/lib/format';
import { priority as priorityStatus, statusPill } from '@/lib/status';
import { projectHealth, riskStatus } from '@/lib/projectStatus';
import { RISK_STATUSES } from '../_model';
import { AiButton, CARD, CHIP, InlineSelect, LoadState, RowMenu, type Handlers } from './_parts';
import type { Lesson, ProjectDetail, ProjectDoc, RiskIssue, StatusUpdate } from './_types';

const count = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;
const PARAGRAPH = 'whitespace-pre-wrap text-ds-body text-ds-fg [overflow-wrap:anywhere]';

export function RisksTab({ project, h }: { project: ProjectDetail; h: Handlers }) {
  const rows = project.risks_issues ?? [];
  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => h.add('risk')}>Add risk or issue</Button>;
  return (
    <div className="flex flex-col gap-[16px]">
      {/* v2 Issue Management linkage: surfaces the platform Issues linked to this project next to the project's own risks below. It hides itself when there are none. */}
      <RelatedIssuesPanel sourceType="is_project" sourceId={project.id} title="Linked Platform Issues" />
      <SectionCard id="risks" title="Risks & issues" meta={rows.length > 0 ? count(rows.length, 'record', 'records') : undefined} actions={<><AiButton h={h} ai="assess-risks">AI assess</AiButton>{add}</>}>
        {rows.length === 0 ? (
          <EmptyState kind="firstUse" bare icon={AlertTriangle} title="No risks or issues recorded" action={add} />
        ) : (
          <ul className="flex flex-col gap-[12px]">
            {rows.map((r: RiskIssue) => (
              <li key={r.id} className={CARD}>
                <div className="flex items-start justify-between gap-[12px]">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
                      <p className="min-w-0 break-words text-ds-body font-[600] text-ds-fg">{r.title || 'Untitled'}</p>
                      <StatusPill size="sm" {...statusPill(priorityStatus, r.severity)} />
                      <StatusPill size="sm" {...statusPill(riskStatus, r.status)} />
                      {r.type && <span className={CHIP}>{r.type}</span>}
                    </div>
                    {r.description && <p className="mt-[4px] text-ds-body text-ds-fg-muted [overflow-wrap:anywhere]">{r.description}</p>}
                    {r.mitigation && <p className="mt-[4px] text-ds-body text-ds-fg-body [overflow-wrap:anywhere]"><span className="font-[600]">Mitigation:</span> {r.mitigation}</p>}
                    <p className="mt-[8px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-ds-label text-ds-fg-muted">
                      {r.owner_name && <span className="inline-flex items-center gap-[6px]">Owner: <PersonChip name={r.owner_name} size={20} /></span>}
                      <span>Identified: {formatDate(r.identified_date)}</span>
                    </p>
                  </div>
                  <RowMenu label={r.title || 'risk'} onDelete={() => h.remove('risk', r.id, r.title || 'this risk')} />
                </div>
                <div className="mt-[12px] flex flex-wrap items-end gap-[12px]">
                  <FormField label="Status" className="w-[168px] max-w-full">
                    <InlineSelect value={r.status} options={RISK_STATUSES} label={`Status of ${r.title}`} onSave={(status) => h.change.risk(r.id, { status })} />
                  </FormField>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

export function UpdatesTab({ project, h }: { project: ProjectDetail; h: Handlers }) {
  const rows = project.status_updates ?? [];
  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => h.add('update')}>Add update</Button>;
  const part = (label: string, text: string | null, danger = false) => (text ? (
    <div>
      <p className={`mb-[2px] text-ds-label font-[600] ${danger ? 'text-ds-danger' : 'text-ds-fg-muted'}`}>{label}</p>
      <p className={PARAGRAPH}>{text}</p>
    </div>
  ) : null);
  return (
    <SectionCard id="updates" title="Status updates" meta={rows.length > 0 ? count(rows.length, 'update', 'updates') : undefined} actions={<><AiButton h={h} ai="draft-status-report">AI draft</AiButton>{add}</>}>
      {rows.length === 0 ? (
        <EmptyState kind="firstUse" bare icon={MessageSquare} title="No status updates yet" action={add} />
      ) : (
        <ul className="flex flex-col gap-[12px]">
          {rows.map((su: StatusUpdate) => (
            <li key={su.id} className={CARD}>
              <div className="flex items-start justify-between gap-[12px]">
                <div className="min-w-0">
                  <PersonChip name={su.author_name} emptyLabel={EMPTY} />
                  <p className="mt-[2px] text-ds-label text-ds-fg-muted">{formatDate(su.update_date)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-[8px]">
                  <StatusPill size="sm" {...statusPill(projectHealth, su.health_status)} />
                  <RowMenu label={`update of ${formatDate(su.update_date)}`} onDelete={() => h.remove('update', su.id, `the update of ${formatDate(su.update_date)}`)} />
                </div>
              </div>
              <div className="mt-[12px] flex flex-col gap-[12px]">
                {part('What was done', su.what_was_done)}
                {part("What's planned", su.whats_planned)}
                {part('Blockers', su.blockers, true)}
                {part('Notes', su.notes)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function DocumentsTab({ project, h }: { project: ProjectDetail; h: Handlers }) {
  const rows = project.documents ?? [];
  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => h.add('document')}>Add document</Button>;
  const menu = (d: ProjectDoc) => (
    <RowMenu
      label={d.title || 'document'}
      onDelete={() => h.remove('document', d.id, d.title || 'this document')}
      deleteLabel="Remove from project"
      extra={[
        { key: 'download', label: 'Download file', icon: Download, hidden: !d.is_uploaded_file, onSelect: () => h.download(d.id, d.file_name || d.title) },
        { key: 'open', label: 'Open link', icon: ExternalLink, hidden: !!d.is_uploaded_file || !d.url, onSelect: () => { if (d.url) window.open(d.url, '_blank', 'noopener,noreferrer'); } },
      ]}
    />
  );
  const columns: Array<RegisterColumn<ProjectDoc>> = [
    {
      key: 'title', header: 'Document', isRowHeader: true,
      cell: (d) => (
        <div className="min-w-0">
          <p className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={d.title}>{d.title || 'Untitled document'}</p>
          {d.description && <p className="truncate text-ds-label text-ds-fg-muted" title={d.description}>{d.description}</p>}
        </div>
      ),
    },
    { key: 'type', header: 'Type', priority: 2, width: 'w-[120px]', card: 'meta', cell: (d) => <span className="text-ds-fg-body">{d.document_type || EMPTY}</span> },
    { key: 'by', header: 'Added by', priority: 3, width: 'w-[152px]', card: 'meta', cell: (d) => <PersonChip name={d.created_by_name} emptyLabel={EMPTY} /> },
    { key: 'added', header: 'Added', width: 'w-[112px]', card: 'meta', cell: (d) => <span className="whitespace-nowrap tabular-nums">{formatDate(d.created_at)}</span> },
    { key: 'actions', header: 'Actions', align: 'right', width: 'w-[56px]', cell: menu },
  ];
  return (
    <SectionCard id="documents" title="Documents" meta={rows.length > 0 ? count(rows.length, 'document', 'documents') : undefined} actions={add}>
      <RegisterTable<ProjectDoc>
        caption="Documents"
        columns={columns}
        rows={rows}
        getRowId={(d) => d.id}
        cardTitle={(d) => <div className="flex items-start justify-between gap-[8px]"><span className="min-w-0 flex-1 break-words font-[600]">{d.title || 'Untitled document'}</span>{menu(d)}</div>}
        empty={<EmptyState kind="firstUse" bare icon={FileText} title="No documents linked yet" action={add} />}
      />
    </SectionCard>
  );
}

export function LessonsTab({ q, h }: { q: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown; data: Lesson[] | undefined }; h: Handlers }) {
  const lessons = q.data ?? [];
  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => h.add('lesson')}>Add lesson</Button>;
  const menu = (l: Lesson) => <RowMenu label={l.title || 'lesson'} onEdit={() => h.edit('lesson', l)} onDelete={() => h.remove('lesson', l.id, l.title || 'this lesson')} />;
  const columns: Array<RegisterColumn<Lesson>> = [
    {
      key: 'title', header: 'Lesson', isRowHeader: true,
      cell: (l) => (
        <div className="min-w-0">
          <p className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={l.title}>{l.title || 'Untitled lesson'}</p>
          {l.description && <p className="line-clamp-2 text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]" title={l.description}>{l.description}</p>}
        </div>
      ),
    },
    { key: 'category', header: 'Category', priority: 2, width: 'w-[136px]', card: 'meta', cell: (l) => <span className="text-ds-fg-body">{l.category || EMPTY}</span> },
    { key: 'impact', header: 'Impact', width: 'w-[96px]', card: 'meta', cell: (l) => <StatusPill size="sm" {...statusPill(priorityStatus, l.impact)} /> },
    { key: 'author', header: 'Author', priority: 3, width: 'w-[152px]', card: 'meta', cell: (l) => <PersonChip name={l.author_name} emptyLabel={EMPTY} /> },
    { key: 'date', header: 'Added', priority: 2, width: 'w-[112px]', card: 'meta', cell: (l) => <span className="whitespace-nowrap tabular-nums">{formatDate(l.created_at)}</span> },
    { key: 'actions', header: 'Actions', align: 'right', width: 'w-[56px]', cell: menu },
  ];
  return (
    <SectionCard id="lessons" title="Lessons learned" meta={lessons.length > 0 ? count(lessons.length, 'lesson', 'lessons') : undefined} actions={add}>
      <LoadState q={q} noun="lessons">
        <RegisterTable<Lesson>
          caption="Lessons learned"
          columns={columns}
          rows={lessons}
          getRowId={(l) => l.id}
          cardTitle={(l) => <div className="flex items-start justify-between gap-[8px]"><span className="min-w-0 flex-1 break-words font-[600]">{l.title || 'Untitled lesson'}</span>{menu(l)}</div>}
          empty={<EmptyState kind="firstUse" bare icon={BookOpen} title="No lessons recorded yet" action={add} />}
        />
      </LoadState>
    </SectionCard>
  );
}
