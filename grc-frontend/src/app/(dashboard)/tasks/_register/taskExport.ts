// The register's export: the tasks shown (or ticked) as a spreadsheet. Pure (no React), tested in taskExport.test.ts. A cell that begins with = + - @ (or a tab / carriage return) would be read as a
// formula by a spreadsheet, so it is written with a leading apostrophe; quotes, commas and line breaks are quoted. Dates are the day as written on screen's rule (the calendar day of a due date).
import { dueMoment, kindOf, KIND_LABEL, type RegisterTask } from '../taskRecord.ts';
import { assigneeNames } from '../tasksModel.ts';

const DAY = (value: string | null | undefined): string => {
  const d = dueMoment(value);
  return d ? d.toISOString().slice(0, 10) : '';
};

/** One cell: text made safe for a spreadsheet (formula guard, quoting). */
export function cell(value: string | number | null | undefined): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const HEADER = ['Title', 'Status', 'Priority', 'Kind', 'Source', 'Category', 'Owners', 'Reviewer', 'Created by', 'Created', 'Due', 'SLA', 'Approval', 'Sub-tasks done', 'Sub-tasks', 'Comments'] as const;

export function toCsv(rows: readonly RegisterTask[]): string {
  const lines = [HEADER.map(cell).join(',')];
  rows.forEach((t) => {
    lines.push([
      t.title, t.status, t.priority, KIND_LABEL[kindOf(t)], t.source_label || t.source, t.category, assigneeNames(t).join('; '), t.reviewer?.display_name ?? '', t.created_by?.display_name ?? '',
      DAY(t.created_at), DAY(t.due_date), t.sla_status, t.approval_required ? (t.approval_status ?? 'Not asked yet') : 'Not needed', t.sub_task_done ?? 0, t.sub_task_total ?? 0, t.comment_count ?? 0,
    ].map(cell).join(','));
  });
  return `${lines.join('\r\n')}\r\n`;
}

/** "tasks-2026-11-10-184.csv" / "tasks-selected-2026-11-10-3.csv" */
export const exportName = (day: string, count: number, selection: boolean): string => `tasks-${selection ? 'selected-' : ''}${day}-${count}.csv`;
