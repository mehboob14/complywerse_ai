// What `GET /is-projects/{id}` and the lazy tab requests send, as the pages read it (the old page typed each row inline). Fields are the server's, unchanged.
import type { ISProject } from '../_model';

export interface Milestone {
  id: number; name: string; description: string | null; target_date: string | null; actual_completion_date: string | null;
  status: string; completion_percentage: number; deliverables: string[];
}
export interface Task {
  id: number; title: string; description?: string | null; assignee_name: string | null; status: string; priority: string; due_date: string | null; progress: number; dependencies: string[];
}
export interface TeamMember { id: number; user_name: string; email: string | null; role: string; responsibilities: string | null; joined_at: string | null }
export interface RiskIssue {
  id: number; title: string; description: string | null; type: string; severity: string; status: string; mitigation: string | null; owner_name: string | null; identified_date: string | null;
}
export interface StatusUpdate {
  id: number; author_name: string | null; update_date: string | null; health_status: string; what_was_done: string | null; whats_planned: string | null; blockers: string | null; notes: string | null;
}
export interface ProjectDoc {
  id: number; title: string; description: string | null; document_type: string | null; url: string | null; is_uploaded_file?: boolean; file_name?: string | null;
  created_by_name: string | null; created_at: string | null;
}
export interface BudgetItem {
  id: number; category: string; description: string | null; amount: number; status: string; approved_by: string | null; notes: string | null; date: string | null; created_at: string | null;
}
export interface Mapping {
  id: number; framework_name: string; control_id: number | null; control_name: string; coverage_status: string; requirement_description: string | null; deliverable: string | null; notes: string | null;
}
export interface Lesson { id: number; title: string; description: string | null; category: string; impact: string; author_name: string | null; created_at: string | null }
export interface Dependency {
  id: number; dependency_type: string; dependent_project_name: string | null; external_dependency: string | null; description: string | null; status: string; direction: string;
  impact_if_delayed: string | null; expected_date: string | null;
}

export interface ProjectDetail extends ISProject {
  business_justification: string | null;
  linked_risks: string[];
  linked_controls: string[];
  linked_frameworks: string[];
  milestones: Milestone[];
  tasks: Task[];
  team_members: TeamMember[];
  risks_issues: RiskIssue[];
  status_updates: StatusUpdate[];
  documents: ProjectDoc[];
}

export interface BudgetData { items?: BudgetItem[]; budget_estimated?: number; total_spent?: number }
