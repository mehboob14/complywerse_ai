// The shapes the meeting workspace reads (GET /committees/meetings/{id} and what hangs off it). One place, so the sections agree on them.

export interface Meeting {
  id: number;
  committee_id: number;
  committee_name?: string | null;
  title: string;
  meeting_type: string;
  scheduled_date: string;
  location?: string | null;
  virtual_link?: string | null;
  status: string;
  quorum_required?: number | null;
  quorum_present?: number | null;
  quorum_met?: boolean | null;
  agenda_item_count?: number;
  action_count?: number;
  papers_count?: number;
  invitees_count?: number;
  has_minutes?: boolean;
  minutes?: {
    id?: number;
    content?: string;
    status?: string;
    drafter_name?: string;
    drafted_at?: string;
  } | null;
}

export interface AgendaItem {
  id: number;
  meeting_id: number;
  item_number: number;
  title: string;
  description?: string | null;
  presenter_name?: string | null;
  time_allocated_minutes?: number | null;
  item_type: string;
  status: string;
  source_type?: string | null;
  linked_document_id?: number | null;
  linked_document_title?: string | null;
  linked_risk_id?: number | null;
  linked_risk_title?: string | null;
  linked_regulatory_change_id?: number | null;
  linked_regulatory_change_title?: string | null;
  outcome?: string | null;
  decision_made?: string | null;
}

export interface SuggestedItem {
  source_type: string;
  source_id: number;
  title: string;
  description?: string;
  item_type: string;
}

export interface MeetingAction {
  id: number;
  title: string;
  description?: string;
  action_type: string;
  action_number?: string;
  meeting_id?: number;
  status: string;
  due_date?: string;
  assignee_name?: string;
  is_overdue?: boolean;
}

export interface MeetingAttachment {
  id: number;
  meeting_id: number;
  file_name: string;
  file_type?: string | null;
  file_size?: number | null;
  description?: string | null;
  uploaded_by_name?: string | null;
  uploaded_at?: string | null;
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
