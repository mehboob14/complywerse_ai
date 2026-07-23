export interface UnifiedDashboard {
  executive_summary: {
    overall_compliance_score: number;
    risk_score: number;
    open_issues: number;
    pending_actions: number;
    trend: 'up' | 'down' | 'stable';
  };
  governance: {
    total_documents: number;
    by_status: Record<string, number>;
    pending_approvals: number;
    expiring_30_days: number;
    overdue_reviews: number;
    recent_publications: Array<{
      id: number;
      title: string;
      doc_type: string;
      published_at: string;
    }>;
  };
  risk: {
    total_risks: number;
    open_risks: number;
    by_category: Record<string, number>;
    by_score_range: { critical: number; high: number; medium: number; low: number };
    avg_residual_score: number;
    heatmap: Array<{ likelihood: number; impact: number; count: number }>;
    incidents_open: number;
    mitigations_overdue: number;
  };
  compliance: {
    frameworks_tracked: number;
    framework_coverage: Array<{
      framework_id: number;
      name: string;
      short_code: string;
      score: number;
      total_controls: number;
      implemented_controls: number;
      status: string;
    }>;
    overall_maturity: number;
    controls_implemented: number;
    controls_total: number;
    evidence_items: number;
    assessments_pending?: number;
  };
  attestations: {
    active_campaigns: number;
    pending_responses: number;
    completion_rate: number;
    overdue: number;
  };
  regulatory_changes: {
    total_changes: number;
    pending_review: number;
    high_impact: number;
    recent: Array<{
      id: number;
      title: string;
      impact_level: string;
      status: string;
    }>;
  };
  upcoming_deadlines: Array<{
    type: string;
    title: string;
    due_date: string;
    days_remaining: number;
    urgency: 'critical' | 'high' | 'medium' | 'low';
    link: string;
  }>;
  recent_activity: Array<{
    type: string;
    action: string;
    title: string;
    timestamp: string;
    status: string;
    link: string;
  }>;
  kpis: {
    compliance_trend: Array<{ month: string; value: number }>;
    risk_trend: Array<{ month: string; value: number }>;
    evidence_trend: Array<{ month: string; value: number }>;
  };
}

export type TabType = 'overview' | 'governance' | 'risk' | 'compliance' | 'executive' | 'compliance_health' | 'treatment' | 'incidents' | 'controls' | 'regulatory';
