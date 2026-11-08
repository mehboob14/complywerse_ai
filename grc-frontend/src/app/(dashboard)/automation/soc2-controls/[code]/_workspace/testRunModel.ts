// The sampled test, apart from React so `node --test` pins it (testRunModel.test.ts). The server (automation/assurance.py) opens a test and draws its sample, takes a result for each sample,
// lets the tester conclude once every sample has one (the rating the samples support, or another one WITH a reason), and lets a reviewer sign it off, which locks it. Signing off one's own test
// is allowed and recorded as not independent (D9). This file holds the rules the page checks before it asks, in the server's own words, so a refusal is rare and a message is plain.

export type StepResult = 'pass' | 'exception' | 'not_applicable';
export type TestResult = 'effective' | 'partially_effective' | 'ineffective';

export interface SampleRow { id: number; seq: number; item_ref: string | null; result: StepResult | null; note: string | null }

export interface TestRow {
  id: number;
  test_type: 'design' | 'operating';
  status: 'in_progress' | 'completed' | 'reviewed';
  result: TestResult | null;
  tester_id: number | null;
  tolerable_exceptions: number;
  sample_size: number | null;
  exceptions_found: number | null;
  suggested_result: TestResult | null;
  locked: boolean;
  independent_review: boolean | null;
  samples: SampleRow[];
}

/** What the samples support, the way the server works it out (testing_rules.suggested_result): nothing until every sample has a result; not applicable items are out of the count. */
export function supported(samples: ReadonlyArray<Pick<SampleRow, 'result'>>, tolerable: number): TestResult | null {
  if (samples.some((s) => s.result == null)) return null;
  const tested = samples.filter((s) => s.result !== 'not_applicable');
  if (tested.length === 0) return null;
  const exceptions = tested.filter((s) => s.result === 'exception').length;
  if (exceptions === 0) return 'effective';
  return exceptions <= Math.max(0, tolerable) ? 'partially_effective' : 'ineffective';
}

export interface Progress { done: number; total: number; exceptions: number; passed: number; open: number }

export function progress(samples: ReadonlyArray<Pick<SampleRow, 'result'>>): Progress {
  const total = samples.length;
  const done = samples.filter((s) => s.result != null).length;
  return { done, total, exceptions: samples.filter((s) => s.result === 'exception').length, passed: samples.filter((s) => s.result === 'pass').length, open: total - done };
}

/** Concluding needs a result on every sample (the server answers 422 otherwise). */
export const canConclude = (t: Pick<TestRow, 'samples' | 'status'>): boolean => t.status === 'in_progress' && t.samples.length > 0 && supported(t.samples, 0) !== null;

/** Deciding for a rating other than the one the samples support needs the tester's reason (the server answers 422 without it). */
export function concludeProblem(suggested: TestResult | null, chosen: TestResult | null, rationale: string): string | null {
  if (suggested == null) return 'Record a result for every sample first.';
  const final = chosen ?? suggested;
  if (final !== suggested && !rationale.trim()) return `The samples support “${RESULT_WORDS[suggested].toLowerCase()}”. Say why you are concluding “${RESULT_WORDS[final].toLowerCase()}” instead.`;
  return null;
}

export const RESULT_WORDS: Record<TestResult, string> = { effective: 'Effective', partially_effective: 'Partially effective', ineffective: 'Ineffective' };
export const STEP_WORDS: Record<StepResult, string> = { pass: 'Pass', exception: 'Exception', not_applicable: 'Not applicable' };

/** A sample's result may be an exception only with a note (the server: "Describe the exception before recording it"). */
export function sampleProblem(result: StepResult | '', note: string): string | null {
  return result === 'exception' && !note.trim() ? 'Describe the exception before recording it.' : null;
}

/** The test that is still being sampled (a control has at most one the page offers to continue: the newest). */
export const inProgress = (tests: readonly TestRow[]): TestRow | undefined => tests.find((t) => t.status === 'in_progress');

/** Signing off the tester's own test is allowed and recorded as not independent; the page says so on the button's side. */
export function signOffNote(t: Pick<TestRow, 'tester_id'>, me: number | null): string | null {
  return me != null && t.tester_id === me ? 'You ran this test, so signing it off is recorded as not independent. It will not make the control satisfactory.' : null;
}

// ── starting a test ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Selection = 'random' | 'systematic' | 'all' | 'judgmental';
export const SELECTION_WORDS: Record<Selection, string> = { random: 'Random', systematic: 'Every nth item', all: 'All items', judgmental: 'Chosen by hand' };

export interface StartForm {
  test_type: 'design' | 'operating';
  frequency: string;
  /** how the population is given: a count, or the items themselves, one a line */
  populationMode: 'count' | 'items';
  count: string;
  items: string;
  selection: Selection;
  /** empty = the recommended size */
  size: string;
  tolerable: string;
  description: string;
}

export const emptyStart = (): StartForm => ({ test_type: 'operating', frequency: '', populationMode: 'count', count: '', items: '', selection: 'random', size: '', tolerable: '0', description: '' });

/** The items typed one a line: trimmed, blanks and repeats dropped (the server selects from unique references). */
export function parseItems(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t) seen.add(t);
  }
  return Array.from(seen);
}

const whole = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** What is wrong with the form before it is sent, in the server's own rules (assurance.start_test); null when it can go. */
export function startProblem(f: StartForm, recommended: number | null): string | null {
  if (f.test_type === 'operating' && f.selection !== 'judgmental') {
    const population = f.populationMode === 'items' ? parseItems(f.items).length : whole(f.count) ?? 0;
    if (population <= 0) return 'Say how many items there are, or list them, so a sample can be drawn from them.';
  }
  if (f.size.trim() && (whole(f.size) ?? 0) < 1) return 'The sample size must be a whole number of at least 1.';
  if (f.test_type === 'operating' && !f.size.trim() && !recommended) return 'Say how often the control operates, or give a sample size.';
  const tolerable = whole(f.tolerable);
  if (tolerable == null || tolerable > 100) return 'Tolerable exceptions must be a whole number from 0 to 100.';
  return null;
}

/** The body of POST .../assurance/tests. A design test is one walkthrough: no population is asked for. */
export function startBody(f: StartForm): Record<string, unknown> {
  const body: Record<string, unknown> = { test_type: f.test_type, selection_method: f.test_type === 'design' ? 'all' : f.selection, tolerable_exceptions: whole(f.tolerable) ?? 0 };
  if (f.frequency) body.frequency = f.frequency;
  if (f.description.trim()) body.population_description = f.description.trim();
  if (f.size.trim()) body.sample_size = whole(f.size);
  if (f.test_type === 'operating') {
    if (f.populationMode === 'items') body.population_items = parseItems(f.items);
    else if (whole(f.count)) body.population_size = whole(f.count);
  }
  return body;
}

/** "Operates quarterly: 2 items" style hint for the form: the server's recommended size for the chosen frequency, or why there is none. */
export function sizeHint(recommended: number | null | undefined, frequencyLabel: string | null): string {
  if (recommended) return `${recommended} ${recommended === 1 ? 'item is' : 'items are'} recommended${frequencyLabel ? ` for a control that operates ${frequencyLabel.toLowerCase()}` : ''}. Leave this empty to use that.`;
  return 'Choose how often the control operates to get a recommended size, or type one.';
}

// ── the quick result ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface QuickForm { test_type: 'design' | 'operating'; result: TestResult; sample: string; exceptions: string; findings: string; frequency: string }

export const emptyQuick = (frequency: string | null): QuickForm => ({ test_type: 'operating', result: 'effective', sample: '25', exceptions: '0', findings: '', frequency: frequency ?? '' });

export function quickProblem(f: QuickForm): string | null {
  const sample = f.sample.trim() === '' ? null : whole(f.sample);
  const exceptions = whole(f.exceptions);
  if (f.sample.trim() !== '' && sample == null) return 'The sample size must be a whole number.';
  if (exceptions == null) return 'Exceptions must be a whole number.';
  if (sample != null && exceptions > sample) return 'Exceptions can’t exceed the sample size.';
  return null;
}

export function quickBody(f: QuickForm): { test_type: 'design' | 'operating'; result: TestResult; sample_size: number | null; exceptions_found: number; findings: string; frequency: string } {
  return { test_type: f.test_type, result: f.result, sample_size: f.sample.trim() === '' ? null : whole(f.sample), exceptions_found: whole(f.exceptions) ?? 0, findings: f.findings.trim(), frequency: f.frequency };
}

/** A completed test that was a quick result has no samples; it is corrected in place, where a sampled one is reopened. */
export const isQuickResult = (t: Pick<TestRow, 'samples'>): boolean => t.samples.length === 0;

/** One line for the test history: "Operating test · 25 sampled · 2 exceptions". */
export function testLine(t: Pick<TestRow, 'test_type' | 'sample_size' | 'exceptions_found' | 'samples'>): string {
  const parts = [`${t.test_type === 'design' ? 'Design' : 'Operating'} test`];
  const sampled = t.sample_size ?? (t.samples.length || null);
  if (sampled) parts.push(`${sampled} sampled`);
  if (t.exceptions_found) parts.push(`${t.exceptions_found} ${t.exceptions_found === 1 ? 'exception' : 'exceptions'}`);
  return parts.join(' · ');
}
