// The shapes of a questionnaire template as the server stores and sends it (backend: routers/questionnaires.py, tpra/versions.py).
// Types only, so the pure modules next to this one can be run by `node --test`.

export type QuestionType = 'text' | 'yes_no' | 'multiple_choice' | 'rating' | 'file';
export type EvidenceMode = 'none' | 'optional' | 'required';

/** An answer option. `score` is 0..1 (a share of full credit); `na`: not applicable, unscored, needs a reason;
 *  `comment_required`: picking it needs a note. A plain string is an unscored option. */
export interface OptionDef { value: string; label?: string; score?: number | null; na?: boolean; comment_required?: boolean }

export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  required: boolean;
  evidence_required: boolean;          // kept for older readers: evidence === 'required'
  // Evidence the supplier gives with the answer; when required, owed on the answers in evidence_on (none listed: any).
  evidence?: EvidenceMode;
  evidence_on?: string[];
  // Who reviews it: its section, else its risk domain (built-in templates), else General.
  section?: string;
  domain?: string;
  weight: number;
  options?: Array<string | OptionDef>;
  /** What a good answer includes, shown under the question to whoever answers it. */
  help?: string;
  /** A gap here raises a critical finding, which blocks approval. */
  critical_control?: boolean;
  // A current certificate (SOC 2, ISO 27001) can answer this yes/no question.
  certificate_covers?: boolean;
  // Ask only when an earlier question was answered with one of these values.
  show_if?: { question: string; in: string[] };
  // When answered one of these, accepting the questionnaire sends this follow-up questionnaire.
  follow_up?: { when: string[]; template_id: number };
  // The built-in templates carry more (key, qtype, order, framework, control_ref): not typed here, and kept as they are
  // when a question is edited (model.questionFromDraft starts from the question it replaces).
}

export interface Template {
  id: number;
  name: string;
  description: string | null;
  category: string;
  questions: Question[];
  question_count: number;
  section_count: number;
  latest_version: number | null;       // sent questionnaires keep the version they were sent on
  used: boolean;                       // ever sent: it can be archived but never deleted
  archived_at: string | null;
  default_tiers: string[];             // the tiers whose list of questionnaires calls for it, worst first
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** Questions to pick from: a starter set, or another questionnaire of the organisation. */
export interface LibrarySet {
  key: string;
  name: string;
  description: string | null;
  source: 'starter' | 'questionnaire';
  questions: Question[];
}
