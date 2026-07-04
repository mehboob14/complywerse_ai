// Data shapes for the ERM overview design system — mirrors the live backend
// contract (GET /erm/dashboard/sections-overview and supporting endpoints).

export interface Metric {
  label: string;
  /** 0-100, or null when the backend has no data yet. */
  score: number | null;
  /** Fraction of the section score, 0-1. */
  weight: number;
  /** Display count e.g. "6/12" (or "—" for no data). */
  count: string;
  /** Human formula, shown only in the detail popup. */
  formula: string;
}

export interface Section {
  key: string;
  label: string;
  /** Fraction of the module score, 0-1. */
  weight: number;
  score: number | null;
  metrics: Metric[];
}

export interface AttentionItem {
  key: string;
  label: string;
  count: number;
  href: string;
  /** Accent color for the tile rail. */
  color: string;
}

/** Rows are Likelihood 5→1 (top→bottom); columns are Impact 1→5 (left→right). */
export interface HeatmapData {
  inherent: number[][];
  residual: number[][];
}

export interface TopRisk {
  id: string;
  title: string;
  /** 0-25 (likelihood x impact). */
  inherent: number;
  residual: number;
}

export interface ModulePerformance {
  score: number;
  grade: string;
  /** Count of sections not yet live (shown as pending weight). */
  upcomingSections: number;
}
