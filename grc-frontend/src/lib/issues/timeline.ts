// The timeline of one issue, apart from React (timeline.test.ts): the server's activity rows (GET /issue-management/issues/{id}/activity, newest first) turned into days of plain
// lines. A line says who did what ("Moved to Closure review"); a detail line says what changed ("Assigned to: Olivia Owner → Lina Khan"); a quote carries the words a person wrote (the
// closure notes, the reason for a reopen, a comment). Nothing technical reaches a screen: no field name with an underscore, no id, no JSON, no key the server invented. A row type
// nobody listed still reads as words (eventLine), and an older row that has less to say (no names, no diff) says less rather than guessing.
import { formatDate, statusLabel } from '../format.ts';
import { parseUtc } from '../serverTime.ts';
import { actionStatus, actionType, issueCategory, issueSeverity, issueState, issueType } from '../statuses/issues.ts';
import { eventLine } from './words.ts';

export interface ActivityRow {
  id: number;
  type: string;
  user?: { id?: number | null; display_name?: string | null } | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
}

/** What kind of thing happened: the page picks an icon for it. */
export type TimelineKind = 'raised' | 'move' | 'close' | 'reopen' | 'edit' | 'comment' | 'action' | 'link' | 'register' | 'other';

export interface TimelineItem {
  id: number;
  kind: TimelineKind;
  who: string;
  line: string;
  /** what changed, one short line each */
  details: string[];
  /** words a person wrote */
  quote: string | null;
  /** the clock time on the viewer's wall: "14:05" */
  time: string;
}
export interface TimelineDay { key: string; label: string; items: TimelineItem[] }

const NOT_SET = 'Not set';
/** The fields a PATCH can change, as a person names them. */
export const FIELD_WORDS: Readonly<Record<string, string>> = {
  title: 'Title',
  description: 'What happened',
  issue_type: 'Type',
  category: 'Category',
  root_cause: 'Root cause',
  root_cause_analysis: 'Root cause analysis',
  owner_id: 'Owner',
  reporter_id: 'Reported by',
  assignee_id: 'Assigned to',
  due_date: 'Due date',
  detected_at: 'Detected',
  impact: 'Impact',
  urgency: 'Urgency',
  severity: 'Severity',
  severity_override: 'Severity change',
};
/** Long text is not repeated in a line: the field is named and said to be edited. */
const LONG_TEXT = ['description', 'root_cause_analysis'];
const DATES = ['due_date', 'detected_at'];
const title = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

const asText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function valueWords(field: string, value: unknown): string {
  const text = asText(value) ?? (typeof value === 'number' ? String(value) : null);
  if (text == null) return NOT_SET;
  if (DATES.includes(field)) return formatDate(text, { calendar: true });
  if (field === 'issue_type') return issueType.label(text);
  if (field === 'category') return issueCategory.label(text);
  if (field === 'severity' || field === 'severity_override') return issueSeverity.label(text);
  if (field === 'impact' || field === 'urgency') return title(text);
  return text;
}

/** The lines for what a PATCH changed: from the structured `diff` when the row has one, else just the names of the fields (older rows kept `changes` as text). */
export function changeLines(payload: Record<string, unknown> | null | undefined): string[] {
  const diff = asRecord(payload?.diff);
  if (diff) {
    return Object.keys(diff).filter((f) => FIELD_WORDS[f]).map((field) => {
      if (LONG_TEXT.includes(field)) return `${FIELD_WORDS[field]} was edited`;
      const d = asRecord(diff[field]) ?? {};
      return `${FIELD_WORDS[field]}: ${valueWords(field, d.old)} → ${valueWords(field, d.new)}`;
    });
  }
  const changes = asRecord(payload?.changes);
  const names = changes ? Object.keys(changes).filter((f) => FIELD_WORDS[f]).map((f) => FIELD_WORDS[f]) : [];
  return names.length ? [`Changed: ${names.join(', ')}`] : [];
}

/** What a linked record is called in a sentence. */
const KIND_WORDS: Readonly<Record<string, string>> = {
  vulnerability: 'vulnerability', risk: 'risk', asset: 'asset', evidence: 'evidence item', vendor: 'vendor', is_project: 'project', project: 'project',
  governance_document: 'document', policy_statement: 'policy statement', governance: 'document',
  control: 'control', control_framework: 'control', control_parsed: 'control', control_normalized: 'control', control_internal: 'control',
};
const COUNT_WORDS: Readonly<Record<string, [string, string]>> = {
  vulnerabilities: ['vulnerability', 'vulnerabilities'], risks: ['risk', 'risks'], assets: ['asset', 'assets'], evidence: ['evidence item', 'evidence items'],
  vendors: ['vendor', 'vendors'], projects: ['project', 'projects'], governance_documents: ['document', 'documents'], policy_statements: ['policy statement', 'policy statements'],
  internal_controls: ['control', 'controls'], tasks: ['task', 'tasks'],
};
const sentence = (n: number, [one, many]: [string, string]): string => `${n} ${n === 1 ? one : many}`;

function linkedCounts(payload: Record<string, unknown> | null | undefined): string[] {
  const out: string[] = [];
  const controls = Object.keys(payload ?? {}).filter((k) => k.startsWith('controls_')).reduce((n, k) => n + (Number(payload?.[k]) || 0), 0);
  Object.keys(COUNT_WORDS).forEach((k) => { const n = Number(payload?.[k]) || 0; if (n > 0) out.push(sentence(n, COUNT_WORDS[k])); });
  if (controls > 0) out.push(sentence(controls, COUNT_WORDS.internal_controls));
  return out;
}

interface Said { kind: TimelineKind; line: string; details: string[]; quote: string | null }

/** What one activity row says. */
export function describe(row: ActivityRow): Said {
  const p = row.payload ?? null;
  const said = (kind: TimelineKind, details: Array<string | null> = [], quote: string | null = null, line = eventLine(row.type, p ?? undefined)): Said => ({ kind, line, details: details.filter((d): d is string => !!d), quote });
  const name = asText(p?.name);
  const actionTitle = asText(p?.title);
  switch (row.type) {
    case 'created': {
      const chosen = asText(p?.override);
      return said('raised', [chosen ? `Severity chosen: ${issueSeverity.label(chosen)}` : null]);
    }
    case 'auto_created': return said('raised');
    case 'status_change': {
      const from = asText(p?.from);
      const to = asText(p?.to);
      return said('move', [from && to ? `${issueState.label(from)} → ${issueState.label(to)}` : null], asText(p?.notes));
    }
    case 'approved': return said('close', [], asText(p?.closure_notes));
    case 'reopened': return said('reopen', [], asText(p?.reason));
    case 'cancelled': return said('move');
    case 'updated': case 'severity_change': return said('edit', changeLines(p));
    case 'commented': return said('comment', [], asText(p?.comment_preview));
    case 'action_added': {
      const kind = asText(p?.action_type);
      return said('action', [actionTitle, kind ? `${actionType.label(kind)} action` : null]);
    }
    case 'action_status_changed': {
      const from = asText(p?.from);
      const to = asText(p?.to);
      return said('action', [actionTitle, from && to ? `${actionStatus.label(from)} → ${actionStatus.label(to)}` : null]);
    }
    case 'action_updated': case 'action_completed': case 'action_deleted': return said('action', [actionTitle]);
    case 'action_verified': return said('action', [actionTitle], asText(p?.notes));
    case 'action_promoted_to_task': return said('action', [asText(p?.task_title)]);
    case 'linked': case 'unlinked': {
      const word = KIND_WORDS[String(p?.target_type ?? '')];
      return said('link', [name], null, `${row.type === 'linked' ? 'Linked' : 'Unlinked'} ${word ? `a ${word}` : 'a record'}`);
    }
    case 'linked_on_create': return said('link', [linkedCounts(p).join(', ') || null]);
    case 'register_created': {
      const fields = p?.fields;
      const filled = Array.isArray(fields) ? fields.length : 0;
      return said('register', [filled > 0 ? `${filled} ${filled === 1 ? 'column' : 'columns'} filled in` : null]);
    }
    case 'register_edit': case 'register_deleted': case 'register_restored': case 'validation_submitted': case 'validation_decision':
    case 'extension_requested': case 'extension_decided': case 'extension_regulator_notified': case 'regulator_status':
      return said('register');
    default: return said('other', [], null, eventLine(row.type, p ?? undefined) || statusLabel(row.type));
  }
}

// ── days ──
const pad = (n: number): string => String(n).padStart(2, '0');
const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "Today", "Yesterday", else "12 Nov 2026": counted in the viewer's calendar days. */
export function dayLabel(day: Date, now: Date): string {
  const days = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return formatDate(day);
}

/** The rows grouped by the viewer's day, newest first (the order the server sends; a row with no readable time goes under "Earlier"). */
export function timelineDays(rows: readonly ActivityRow[], now: Date = new Date()): TimelineDay[] {
  const days: TimelineDay[] = [];
  for (const row of rows) {
    const at = parseUtc(row.created_at);
    const key = at ? dayKey(at) : 'unknown';
    const item: TimelineItem = { id: row.id, ...describe(row), who: row.user?.display_name?.trim() || 'The platform', time: at ? timeOf(at) : '' };
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(item);
    else days.push({ key, label: at ? dayLabel(at, now) : 'Earlier', items: [item] });
  }
  return days;
}

/** The newest `count` rows as items, for the Overview's "Latest activity". */
export const latestItems = (rows: readonly ActivityRow[], count = 3): TimelineItem[] => timelineDays(rows.slice(0, count)).flatMap((d) => d.items);
