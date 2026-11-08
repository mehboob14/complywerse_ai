// The shapes the Regulatory Changes and Feed screens read. Types only: nothing runs when this file loads.

/** One circular the organisation is working through (GET /changes, GET /changes/:id). The three counts after `late_task_count` come with the list only (the detail leaves them 0). */
export interface ChangeRow {
  id: number;
  title: string;
  description?: string | null;
  source: string;
  reference_number?: string | null;
  effective_date?: string | null;
  publication_date?: string | null;
  status: string;
  priority: string;
  impact_summary?: string | null;
  gap_count?: number;
  assigned_to?: number | null;
  assignee_name?: string | null;
  creator_name?: string | null;
  assessment_count?: number;
  task_count?: number;
  completed_task_count?: number;
  late_task_count?: number;
  obligation_count?: number;
  met_count?: number;
  to_check_count?: number;
  suggestion_count?: number;
  created_at: string;
  updated_at?: string;
  closed_at?: string | null;
  closed_by_name?: string | null;
  /** The reading of the circular in progress or last run (backend regulatory_engine). */
  analysis?: Analysis | null;
}

export interface Analysis {
  status: 'queued' | 'running' | 'done' | 'failed';
  step?: string;
  done_steps?: number;
  total_steps?: number;
  found?: number;
  error?: string;
  seconds?: number;
  counts?: { obligations?: number; verified?: number; unverified?: number; tasks_created?: number; assessments_created?: number; sections?: number; failed?: string[] };
}

export interface Assessment {
  id: number;
  assessment_type?: string;
  impacted_item_id?: number | null;
  impacted_item_type?: string | null;
  impacted_item_name?: string | null;
  impact_level: string;
  impact_description?: string | null;
  affected_areas?: string | null;
  gap_identified?: boolean;
  gap_description?: string | null;
  compliance_gaps?: string | null;
  recommendations?: string | null;
  assessor_name?: string | null;
  assessment_date?: string | null;
}

export interface Task {
  id: number;
  title: string;
  description?: string | null;
  task_type: string;
  status: string;
  priority?: string;
  assigned_to?: number | null;
  assignee_name?: string | null;
  assignee_department?: string | null;
  creator_name?: string | null;
  /** Everyone on it (assigned_to is the first of them). */
  assignee_ids?: number[];
  assignees?: Array<{ id: number; display_name: string; department?: string | null }>;
  due_date?: string | null;
  completed_at?: string | null;
  created_at?: string;
  is_overdue?: boolean;
  impact_assessment_id?: number | null;
  /** The obligation it was raised from. */
  obligation_id?: number | null;
  /** Its twin in Task Management (/tasks/:id). */
  critical_task_id?: number | null;
  linked_policy_id?: number | null;
  linked_policy_title?: string | null;
  linked_control_id?: number | null;
  linked_control_name?: string | null;
}

/** A task not yet created, prefilled from wherever it was raised. */
export type TaskDraft = Omit<Partial<Task>, 'id'> & { id?: undefined };

export interface Obligation {
  id: number;
  ref: string | null;
  quote: string | null;
  summary: string;
  obligation_type: string;
  applies_to: string[];
  deadline: string | null;
  deadline_text: string | null;
  priority: string;
  verified: boolean;
  match_score: number | null;
  compliance_status: string;
  owner_id: number | null;
  owner_name: string | null;
  owner_ids?: number[];
  owners?: Array<{ id: number; display_name: string }>;
  department: string | null;
  notes: string | null;
  source: 'ai' | 'manual';
}

/** An obligation linked to a control (regulatory_links.py). */
export interface RegLink {
  id: number;
  obligation_id: number | null;
  target_type: string;
  target_id: number;
  target_ref: string | null;
  target_label: string | null;
  rationale: string | null;
  score: number | null;
  status: 'proposed' | 'confirmed' | 'rejected';
  source: 'ai' | 'match' | 'manual';
  decided_by: string | null;
}

export interface Person { id: number; display_name: string; email?: string | null; department?: string | null }
export interface RoleRow { id: number; name: string; user_count: number }
export interface People { users: Person[]; roles: RoleRow[] }

/** GET /overview: counted by the server over every change still being worked on. */
export interface OverviewPayload {
  changes: { open: number; by_status: Record<string, number>; effective_soon: number; in_force: number };
  obligations: { total: number; by_compliance: Record<string, number>; to_check: number; met: number; without_control: number; suggestions: number };
  tasks: { open: number; late: number; unassigned: number };
  feed: { new: number };
}

/** GET /my-work */
export interface MyWorkPayload {
  tasks: Array<{ id: number; change_id: number; change_title: string; title: string; status: string; priority: string; due_date: string | null; late: boolean }>;
  tasks_total: number;
  obligations: Array<{ id: number; change_id: number; change_title: string; ref: string | null; summary: string; priority: string; deadline: string | null }>;
  obligations_total: number;
  changes: Array<{ id: number; title: string; source: string; status: string; priority: string; effective_date: string | null }>;
  changes_total: number;
  feed_new: number;
}

export interface FeedAssignee { type: 'user' | 'role'; id: number; name?: string | null; email?: string | null }

export interface FeedSource {
  id: number;
  name: string;
  regulator: string | null;
  country: string | null;
  category: string | null;
  source_url: string;
  source_type: string;
  is_active: boolean;
  poll_interval_hours: number;
  last_polled_at: string | null;
  last_successful_poll: string | null;
  items_processed: number;
  assignees?: FeedAssignee[];
  assignee_count?: number;
}

export interface FeedAnalysis {
  summary?: string;
  priority?: string;
  effective_date_estimate?: string | null;
  compliance_gaps?: string[];
  impacted_frameworks?: Array<{ name: string; relevance?: string; reason?: string }>;
  impacted_controls?: Array<{ id: string; name: string; gap_type?: string; action_needed?: string }>;
  impacted_policies?: Array<{ title: string; action_needed?: string }>;
  implementation_tasks?: Array<{ title: string; description?: string; priority?: string; suggested_deadline_days?: number }>;
  recommendations?: string[];
  analyzed_at?: string;
  /** set when the AI answered but the answer could not be used */
  error?: string;
}

export interface FeedItem {
  id: number;
  feed_source_id: number;
  feed_source_name: string | null;
  guid: string;
  title: string;
  link: string | null;
  description: string | null;
  content: string | null;
  published_date: string | null;
  status: string;
  ai_analysis: FeedAnalysis | null;
  regulatory_change_id: number | null;
  processed_at: string | null;
  created_at: string;
}

export interface FeedCounts { new: number; analyzed: number; processed: number; ignored: number; total: number }
