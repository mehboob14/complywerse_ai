import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frameworkTypeLabel, lastFailedRuns } from './_gapAnalysis.ts';

test('a run the server could not start (it marks it failed) is asked for again, so it shows as failed at once', () => {
  const src = readFileSync(new URL('./_GapAnalysisView.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes("onError: () => queryClient.invalidateQueries({ queryKey: ['gap-analysis-runs', id] }),"));
});

test('a failed run stays shown until the framework is run again, newest first', () => {
  const runs = [
    { id: 5, uploaded_framework_id: 1, framework_name: 'NCA ECC', status: 'completed', started_at: '2026-10-19T10:00:00' },
    { id: 4, uploaded_framework_id: 2, framework_name: 'PDPL', status: 'failed', started_at: '2026-10-19T09:00:00', error_message: 'The document could not be read.' },
    { id: 3, uploaded_framework_id: 1, framework_name: 'NCA ECC', status: 'failed', started_at: '2026-10-18T09:00:00' },
    { id: 6, uploaded_framework_id: 3, framework_name: 'ISO 27001', status: 'failed', started_at: '2026-10-19T11:00:00' },
    { id: 7, uploaded_framework_id: 4, framework_name: 'SOC 2', status: 'running', started_at: '2026-10-19T12:00:00' },
    { id: 2, uploaded_framework_id: 4, framework_name: 'SOC 2', status: 'failed', started_at: '2026-10-17T09:00:00' },
  ];
  assert.deepEqual(lastFailedRuns(runs).map((r) => r.id), [6, 4]);       // NCA worked since, SOC 2 runs again
  assert.deepEqual(lastFailedRuns([]), []);
  assert.deepEqual(lastFailedRuns([{ id: 1, status: 'failed', framework_name: 'Old' }]).map((r) => r.id), [1]);
});

test('framework types read as words, not slugs', () => {
  assert.equal(frameworkTypeLabel('best_practice'), 'Best practice');
  assert.equal(frameworkTypeLabel('international_standard'), 'International standard');
  assert.equal(frameworkTypeLabel('NIST'), 'NIST');
  assert.equal(frameworkTypeLabel(null), '');
});
