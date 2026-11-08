// What the framework document editor knows, as plain functions (no React), so `node --test` can pin it: where a section stands, the counts of the
// progress line, the text tools of the editor, the edits of a section's table, the AI's draft merged into the sections, the workflow guard, the file
// that is downloaded and the governance document that is published. The document is the one the server keeps (framework_templates/routers/documents.py).

export interface DocTable { columns: string[]; rows: string[][] }
export type SectionWord = 'ready' | 'draft' | 'to_start';
export interface DocSection { heading: string; body: string; table?: DocTable; status?: SectionWord; ref?: string }

export interface FrameworkDoc {
  id: number;
  doc_type: string;
  title: string | null;
  control_ref: string | null;
  organization: string | null;
  owner_id: number | null;
  owner_name: string | null;
  classification: string | null;
  version: string | null;
  approved_by: string | null;
  approval_date: string | null;
  effective_date: string | null;
  next_review_date: string | null;
  status: string | null;
  reviewer_id: number | null;
  approver_id: number | null;
  submitted_for_review_at: string | null;
  sections: DocSection[];
}

export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export const DOC_STATUSES = ['draft', 'in_review', 'approved'] as const;

/** Where a section stands: the word it carries, else read from its text (any text or table row makes it a draft). */
export function sectionState(s: DocSection): SectionWord {
  if (s.status === 'ready' || s.status === 'draft' || s.status === 'to_start') return s.status;
  const hasBody = !!(s.body && s.body.trim());
  const hasRows = !!(s.table && s.table.rows.length);
  return hasBody || hasRows ? 'draft' : 'to_start';
}

export function sectionCounts(sections: DocSection[]): Record<SectionWord, number> {
  const c: Record<SectionWord, number> = { ready: 0, draft: 0, to_start: 0 };
  sections.forEach((s) => { c[sectionState(s)] += 1; });
  return c;
}

/** The progress line: "5 ready · 2 draft · 3 to start". */
export function countsLine(sections: DocSection[]): string {
  const c = sectionCounts(sections);
  return `${c.ready} ready · ${c.draft} draft · ${c.to_start} to start`;
}

export const wordCount = (body: string): number => ((body || '').trim() ? (body || '').trim().split(/\s+/).length : 0);

/** A [bracketed placeholder] still in the text: the template's blanks to fill before review. */
export const hasPlaceholder = (body: string): boolean => /\[[^\]\n]{1,48}\]/.test(body || '');

/** Whether removing the section would lose something a person wrote. */
export const sectionHasContent = (s: DocSection): boolean => !!(s.body && s.body.trim()) || !!(s.table && s.table.rows.some((r) => r.some((c) => c && c.trim())));

/** The governance document type a framework document is published as. */
export function govDocType(d: { doc_type?: string; title?: string | null }): 'policy' | 'procedure' | 'standard' | 'guideline' | 'template' | 'other' {
  const s = `${d.doc_type || ''} ${d.title || ''}`.toLowerCase();
  if (s.includes('procedure')) return 'procedure';
  if (s.includes('standard')) return 'standard';
  if (s.includes('guideline') || s.includes('guide')) return 'guideline';
  if (s.includes('plan')) return 'procedure';
  return 'policy';
}

// ── the workflow ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What the one workflow button does: a draft goes for review, a document in review is approved, an approved one has no next step here. */
export function nextStep(status: string | null | undefined): { to: 'in_review' | 'approved'; label: string } | null {
  const s = status || 'draft';
  if (s === 'draft') return { to: 'in_review', label: 'Send for review' };
  if (s === 'in_review') return { to: 'approved', label: 'Approve' };
  return null;
}

/** Sending for review needs a reviewer and an approver (the page has always asked for both before it sent). The server does not check; the page does. */
export const canSendForReview = (doc: Pick<FrameworkDoc, 'reviewer_id' | 'approver_id'>): boolean => !!doc.reviewer_id && !!doc.approver_id;

/** What a save sends: every field of the details and the sections. */
export function saveBody(d: FrameworkDoc): Record<string, unknown> {
  return {
    title: d.title, organization: d.organization, owner_id: d.owner_id, owner_name: d.owner_name,
    classification: d.classification, version: d.version, approved_by: d.approved_by,
    approval_date: d.approval_date, effective_date: d.effective_date, next_review_date: d.next_review_date,
    status: d.status, reviewer_id: d.reviewer_id, approver_id: d.approver_id, sections: d.sections,
  };
}

// ── editing the sections ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const patchSection = (sections: DocSection[], idx: number, patch: Partial<DocSection>): DocSection[] =>
  sections.map((s, i) => (i === idx ? { ...s, ...patch } : s));

export function setTableCell(sections: DocSection[], sIdx: number, r: number, c: number, value: string): DocSection[] {
  return sections.map((s, i) => {
    if (i !== sIdx || !s.table) return s;
    const rows = s.table.rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row));
    return { ...s, table: { ...s.table, rows } };
  });
}

export const addTableRow = (sections: DocSection[], sIdx: number): DocSection[] =>
  sections.map((s, i) => (i === sIdx && s.table ? { ...s, table: { ...s.table, rows: [...s.table.rows, s.table.columns.map(() => '')] } } : s));

export const removeTableRow = (sections: DocSection[], sIdx: number, r: number): DocSection[] =>
  sections.map((s, i) => (i === sIdx && s.table ? { ...s, table: { ...s.table, rows: s.table.rows.filter((_, ri) => ri !== r) } } : s));

export const NEW_SECTION: DocSection = { heading: 'New section', body: '', status: 'to_start' };

/** The section that is open after one is removed: the one before it, never below the first. */
export const openAfterRemove = (open: number, removed: number): number => Math.max(0, open >= removed ? open - 1 : open);

/** The section to show: the open one, kept inside the list. */
export const clampIndex = (open: number, length: number): number => Math.min(Math.max(0, open), Math.max(0, length - 1));

/** The AI's draft merged in: the whole document, or one section by its heading. A section with a table is never overwritten, a section the AI did not
 *  draft keeps its text, and a draft with no text keeps what was there. */
export function mergeDraft(sections: DocSection[], drafted: Array<{ heading: string; body: string }>, target?: string): DocSection[] {
  const byHeading = new Map(drafted.map((s) => [s.heading, s.body]));
  return sections.map((s) => {
    if (target && s.heading !== target) return s;
    return !s.table && byHeading.has(s.heading) ? { ...s, body: byHeading.get(s.heading) || s.body } : s;
  });
}

// ── the text tools of the editor ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TextEdit { text: string; selStart: number; selEnd: number }

/** **bold**, *italic*, [link](https://): wrap the selection (or the word "text" when nothing is selected) and select what was wrapped. */
export function wrapSelection(text: string, start: number, end: number, before: string, after: string): TextEdit {
  const sel = text.slice(start, end) || 'text';
  return { text: text.slice(0, start) + before + sel + after + text.slice(end), selStart: start + before.length, selEnd: start + before.length + sel.length };
}

/** A bullet on every line of the selection (from the start of its first line), leaving lines that already have one and blank lines. */
export function bulletLines(text: string, start: number, end: number): TextEdit {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const block = text.slice(lineStart, end) || 'item';
  const bulleted = block.split('\n').map((l) => (l.startsWith('- ') || !l.trim() ? l : `- ${l}`)).join('\n');
  const next = text.slice(0, lineStart) + bulleted + text.slice(end);
  return { text: next, selStart: lineStart, selEnd: lineStart + bulleted.length };
}

// ── the files ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The document as Markdown: the download, and the content of the governance document it is published as. */
export function toMarkdown(doc: FrameworkDoc): string {
  const lines: string[] = [`# ${doc.title || 'Document'}`, '',
    [doc.version ? `**Version:** ${doc.version}` : '', doc.status ? `**Status:** ${doc.status}` : '',
      doc.classification ? `**Classification:** ${doc.classification}` : '', doc.organization ? `**Organization:** ${doc.organization}` : '']
      .filter(Boolean).join('  \n'), ''];
  doc.sections.forEach((s) => {
    lines.push(`## ${s.heading}`, '');
    if (s.body) lines.push(s.body, '');
    if (s.table) {
      lines.push(`| ${s.table.columns.join(' | ')} |`, `| ${s.table.columns.map(() => '---').join(' | ')} |`);
      s.table.rows.forEach((r) => lines.push(`| ${r.map((c) => (c || '').replace(/\|/g, '\\|')).join(' | ')} |`));
      lines.push('');
    }
  });
  return lines.join('\n');
}

/** "ISMS Scope Statement.md": the title with anything a file name cannot hold replaced by an underscore. */
export const downloadName = (doc: Pick<FrameworkDoc, 'title'>): string => `${(doc.title || 'document').replace(/[^a-z0-9_\- ]/gi, '_').trim() || 'document'}.md`;

/** The governance document made from the framework document (the description names the framework and the clause). */
export function publishBody(doc: FrameworkDoc, frameworkName: string, frameworkId: number | null): Record<string, unknown> {
  return {
    title: doc.title || 'Document',
    description: [frameworkName, doc.control_ref].filter(Boolean).join(' · '),
    content: toMarkdown(doc),
    doc_type: govDocType(doc),
    classification: doc.classification || 'internal',
    owner_id: doc.owner_id ?? undefined,
    effective_date: doc.effective_date ?? undefined,
    framework_ids: frameworkId ? [frameworkId] : [],
    applicable_framework_ids: frameworkId ? [frameworkId] : [],
  };
}
