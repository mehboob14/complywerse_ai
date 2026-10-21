import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frameworkTypeLabel, lastFailedRuns, outdatedRuns } from './_gapAnalysis.ts';

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

test('results made on another version of the document say so until their framework is run on the current one', () => {
  const runs = [
    { id: 1, uploaded_framework_id: 1, framework_name: 'NCA ECC', status: 'completed', started_at: '2026-10-18T09:00:00', document_version: '1.0' },
    { id: 2, uploaded_framework_id: 2, framework_name: 'PDPL', status: 'completed', started_at: '2026-10-19T09:00:00', document_version: '1.1' },
    { id: 3, uploaded_framework_id: 3, framework_name: 'ISO 27001', status: 'completed', started_at: '2026-10-17T09:00:00', document_version: '1.0' },
    { id: 4, uploaded_framework_id: 3, framework_name: 'ISO 27001', status: 'running', started_at: '2026-10-20T09:00:00', document_version: '1.1' },
    { id: 5, uploaded_framework_id: 4, framework_name: 'SOC 2', status: 'completed', started_at: '2026-10-16T09:00:00' },   // before versions were kept
    { id: 6, uploaded_framework_id: 5, framework_name: 'PCI DSS', status: 'completed', started_at: '2026-10-15T09:00:00', document_version: '0.9' },
  ];
  // the document is at 1.1: PDPL was made on it, ISO 27001 runs on it again, SOC 2 says nothing; newest first
  assert.deepEqual(outdatedRuns(runs, '1.1').map((r) => r.id), [1, 6]);
  assert.deepEqual(outdatedRuns(runs, '1.0').map((r) => r.id), [2, 6]);
  assert.deepEqual(outdatedRuns(runs, null), []);
  assert.deepEqual(outdatedRuns([], '1.1'), []);
});

test('framework types read as words, not slugs', () => {
  assert.equal(frameworkTypeLabel('best_practice'), 'Best practice');
  assert.equal(frameworkTypeLabel('international_standard'), 'International standard');
  assert.equal(frameworkTypeLabel('NIST'), 'NIST');
  assert.equal(frameworkTypeLabel(null), '');
});
