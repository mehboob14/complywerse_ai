// node --test "src/app/(dashboard)/evidence/_insights/insightsModel.test.ts"
// The figures of the Evidence Insights tab: tiles from the server's summary (Approved and In force side by side, nothing is not 0%), the lists worked out from the same rows and rules as the
// Library, the owner table, and the framework coverage with its two readings.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { EvidenceItem, EvidenceSummary } from '../_workspace/evidenceModel.ts';
import { LOW_MATURITY, attention, coverageLine, coverageRows, insightTiles, libraryLinkForFramework, ownerTable, type Coverage } from './insightsModel.ts';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW + days * DAY).toISOString().slice(0, 19);
let n = 0;
const row = (over: Partial<EvidenceItem> = {}): EvidenceItem => {
  n += 1;
  return {
    id: n, tenant_id: 1, name: `File ${n}`, description: null, file_path: null, file_name: null, file_type: null, version: 1, uploaded_by: 1, uploader_name: 'Ayesha', uploaded_at: at(-n),
    status: 'approved', ocr_status: 'completed', ocr_processed_at: null, evidence_type: 'policy', collection_date: null, validity_period_days: null, expiry_date: at(100), is_stale: false,
    source_system: null, content_summary: null, quality_score: 0.9, submitted_by: null, submitted_at: null, reviewed_by: null, reviewed_at: null, review_comments: null, approved_by: null,
    approved_at: null, owner_id: 2, owner_name: 'Bilal', lapsed: false, ...over,
  };
};

test('the tiles: true totals from the summary, Approved (the status) beside In force (approved and in date), and no files is not 0%', () => {
  const s: EvidenceSummary = { total_count: 200, by_status: { approved: 80, draft: 60, pending_review: 40, expired: 20 }, by_type: {}, stale_count: 25, lapsed_count: 25, in_force_count: 60, expiring_soon_count: 7, pending_review_count: 40 };
  assert.deepEqual(insightTiles(s), { total: 200, approved: 80, approvedPct: 40, inForce: 60, inForcePct: 30, pending: 40, expiring: 7, lapsed: 25 });
  assert.equal(insightTiles({ total_count: 0, by_status: {}, by_type: {}, stale_count: 0, expiring_soon_count: 0, pending_review_count: 0 })?.approvedPct, null);
  const older = insightTiles({ total_count: 10, by_status: { approved: 5 }, by_type: {}, stale_count: 2, expiring_soon_count: 0, pending_review_count: 0 });
  assert.equal(older?.inForcePct, null, 'a server that sends no in-force figure: not recorded, not guessed');
  assert.equal(older?.lapsed, 2, 'the old stale count is the lapsed count of a server that does not send the new one');
  assert.equal(insightTiles(undefined), null);
});

test('what needs a look: lapsed worst first, expiring soonest first, low maturity lowest first; archived files and unrated files are in none', () => {
  const rows = [
    row({ expiry_date: at(-2) }), row({ expiry_date: at(-40) }), row({ status: 'expired', expiry_date: null, lapsed: true }), row({ expiry_date: at(5), quality_score: 0.3 }),
    row({ expiry_date: at(20), quality_score: 12 }), row({ expiry_date: at(300), quality_score: null }), row({ status: 'archived', expiry_date: at(-9), quality_score: 0.1 }), row({ quality_score: 0 }),
  ];
  const a = attention(rows, NOW);
  assert.deepEqual(a.lapsed.map((r) => r.id), [rows[1].id, rows[0].id, rows[2].id], 'longest lapsed first; no date last');
  assert.deepEqual(a.expiring.map((r) => r.id), [rows[3].id, rows[4].id]);
  assert.deepEqual(a.low.map((r) => r.id), [rows[7].id, rows[4].id, rows[3].id], 'a score of 0 is a score; 12 and 0.3 (30) are below 50');
  assert.equal(LOW_MATURITY, 50);
});

test('by owner: the designated owner, else the uploader, else Unassigned; approved, in force, pending and lapsed counted per owner; archived files are not counted', () => {
  const rows = [
    row({ owner_id: 2, owner_name: 'Bilal' }), row({ owner_id: 2, owner_name: 'Bilal', expiry_date: at(-1) }), row({ owner_id: 2, owner_name: 'Bilal', status: 'pending_review' }),
    row({ owner_id: null, owner_name: null, uploaded_by: 5, uploader_name: 'Carla' }), row({ owner_id: null, owner_name: null, uploaded_by: null, uploader_name: null }),
    row({ owner_id: 2, owner_name: 'Bilal', status: 'archived' }),
  ];
  const table = ownerTable(rows, NOW);
  assert.deepEqual(table.map((o) => [o.name, o.total, o.approved, o.inForce, o.pending, o.lapsed]), [['Bilal', 3, 2, 1, 1, 1], ['Carla', 1, 1, 1, 0, 0], [null, 1, 1, 1, 0, 0]]);
});

test('coverage: frameworks with controls only, the least covered first; the line says what "evidence" means', () => {
  const fw = (id: number, name: string, total: number, withEv: number): Coverage['frameworks'][number] => ({
    framework_id: id, framework_name: name, total_controls: total, controls_with_evidence: withEv, controls_without_evidence: total - withEv, coverage_percentage: total ? Math.round((withEv / total) * 1000) / 10 : 0,
  });
  const c: Coverage = { total_controls: 60, controls_with_evidence: 40, coverage_percentage: 66.7, frameworks: [fw(1, 'ISO', 50, 40), fw(2, 'Empty', 0, 0), fw(3, 'NCA', 10, 0), fw(4, 'Another', 10, 0)] };
  assert.deepEqual(coverageRows(c).map((f) => f.framework_name), ['Another', 'NCA', 'ISO']);
  assert.equal(coverageLine(fw(1, 'ISO', 50, 40)), '40 of 50 controls have evidence linked');
  assert.equal(coverageLine(fw(1, 'ISO', 1, 1)), '1 of 1 control has evidence linked');
  assert.deepEqual(coverageRows(undefined), []);
  assert.equal(libraryLinkForFramework('ISO 27001:2022 & more'), '/evidence?fw=ISO%2027001%3A2022%20%26%20more');
});
