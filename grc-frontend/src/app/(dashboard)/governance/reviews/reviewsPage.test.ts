// node --test "src/app/(dashboard)/governance/reviews/reviewsPage.test.ts"
// Source-text pins for Governance > Reviews and its calendar (like archive.test.ts): what the pages must not contain any more (the date shift, the browser's own
// dialogs) and what they must still do exactly as before (the endpoints, the query keys, the invalidations, the payload, who sees Complete Review). There is no
// React renderer here; what these pages do on screen is checked in a browser (the G4-C evidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const read = (name: string): string => readFileSync(`${DIR}${name}`, 'utf8').replace(/\r\n/g, '\n');
/** the source without its comments, so a rule written in a comment is not a use */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const files = (readdirSync(DIR, { recursive: true }) as string[])
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

test('the two pages and everything they are made of (the files of the folder)', () => {
  assert.deepEqual(files.sort(), [
    '_ActionsSection.tsx', '_DocumentReviews.tsx', '_ReviewCalendar.tsx', '_ReviewList.tsx', '_parts.tsx', '_queries.ts', '_useCompleteReview.tsx', '_useReviewsLocation.ts',
    'calendar/page.tsx', 'calendarModel.ts', 'page.tsx', 'reviewsModel.ts',
  ]);
});

test('no review date is turned into a UTC string or read through the viewer\'s zone: no toISOString().split, no toLocale*String, no Date parsing of a stored date', () => {
  for (const f of files) {
    const source = code(read(f));
    assert.ok(!/toISOString\(\)\s*\.split/.test(source), `${f}: toISOString().split`);
    assert.ok(!/toISOString\(/.test(source), `${f}: toISOString`);
    assert.ok(!/toLocale\w*String/.test(source), `${f}: toLocale*String`);
    assert.ok(!/new Date\(\s*(?:\w+\.)*(?:next_review_date|last_reviewed_at|action_date)\b/.test(source), `${f}: new Date(<a stored date>)`);
  }
});

test('the only clock read is the viewer\'s today (calendarModel.todayKey) and the moment of an answer (new Date() in the calendar)', () => {
  const reads = files.filter((f) => /new Date\(|Date\.now\(/.test(code(read(f))));
  assert.deepEqual(reads.sort(), ['_ReviewCalendar.tsx', 'calendarModel.ts']);
  assert.ok(/new Date\(\)/.test(code(read('_ReviewCalendar.tsx'))));
});

test('no window.confirm, alert or prompt is left in these pages: the question is the kit\'s confirm dialog', () => {
  for (const f of files) {
    const source = code(read(f));
    assert.ok(!/window\.(confirm|alert|prompt)\b|(^|[^\w.])(confirm|alert|prompt)\(/.test(source.replace(/await confirm\(\{/g, '')), `${f}: a native dialog`);
  }
  const complete = read('_useCompleteReview.tsx');
  assert.ok(complete.includes('useConfirm()') && complete.includes('confirmLabel:'), 'asks through useConfirm');
  assert.ok(complete.includes('useReportedMutation('), 'reports through useReportedMutation');
  assert.ok(/confirmLabel: 'Complete review'/.test(complete), 'the button says what it does');
});

test('Complete Review sends the same request as ever: POST completeReview(id) with no payload of its own, and the same three queries are refreshed (plus the calendar\'s month)', () => {
  const complete = code(read('_useCompleteReview.tsx'));
  assert.equal((complete.match(/governanceApi\.completeReview\(/g) ?? []).length, 1);
  assert.ok(complete.includes('governanceApi.completeReview(doc.id)'), 'the id only: no notes, no next_review_date');
  assert.ok(/invalidate: \[\['governance-review-statistics'\], \['governance-reviews-overdue'\], \['governance-reviews-upcoming'\], \['governance-review-calendar'\]\]/.test(complete));
  assert.ok(complete.includes("failure: \"Couldn't complete the review\""), 'a failure says so, with the server\'s words');
  assert.ok(!/retryable:\s*false/.test(complete), 'a failed completion offers Retry where trying again can help');
});

test('every request keeps its endpoint call, its query key and its window', () => {
  const q = code(read('_queries.ts'));
  assert.ok(q.includes("queryKey: ['governance-review-statistics']") && q.includes('governanceApi.getReviewStatistics()'));
  assert.ok(q.includes("queryKey: ['governance-reviews-overdue', type]") && q.includes('governanceApi.getOverdueReviews(params)'));
  assert.ok(q.includes("queryKey: ['governance-reviews-upcoming', type]") && q.includes('governanceApi.getUpcomingReviews(params)'));
  assert.ok(/const params: Record<string, string \| number> = \{ days: 90, limit: REVIEW_FETCH_LIMIT \}/.test(q), 'upcoming still looks 90 days ahead');
  assert.ok(q.includes("if (type) params.doc_type = type;"), 'the type filter is the doc_type param');
  assert.ok(q.includes("queryKey: ['governance-review-calendar', year, month]") && q.includes('governanceApi.getReviewCalendar({ year, month })'));
  assert.ok(q.includes("queryKey: ['my-pending-reviews', filter]"));
  assert.ok(q.includes("filter === 'pending_review' || filter === 'all'") && q.includes('governanceApi.getMyPendingReviews(') && q.includes('governanceApi.getAllGovernanceActions('));
  assert.ok(q.includes('status_filter: filter'));
  assert.equal((q.match(/governanceApi\.\w+\(/g) ?? []).length, 6, 'no other endpoint is called');
});

test('a failed request is said, never read as zero or as an empty list, and Retry is offered only where trying again can help (not for a refusal)', () => {
  for (const f of ['_ReviewList.tsx', '_DocumentReviews.tsx', '_ReviewCalendar.tsx', '_ActionsSection.tsx']) {
    const source = code(read(f));
    assert.ok(source.includes('canRetry(') && source.includes('errorMessage('), `${f}: the server's words, Retry only when it can help`);
  }
  assert.ok(code(read('_queries.ts')).includes('failures < 3 && canRetry(error)'), 'a refused request is not tried three times');
  const list = code(read('_ReviewList.tsx'));
  assert.ok(list.includes('error={failed ?'), 'a failed list is an error row, not an empty table');
  assert.ok(code(read('_DocumentReviews.tsx')).includes('stats.isError'), 'failed counts are an error, not 0');
});

test('who sees Complete Review is unchanged: the same permission key, read the same way, and no new guard', () => {
  const page = code(read('page.tsx'));
  assert.ok(page.includes("hasPermission('governance:document_management:edit')"));
  for (const f of files) {
    const source = code(read(f));
    assert.ok(!/PermissionGuard|NoAccessState|requirePermission/.test(source), `${f}: a guard`);
    if (f !== 'page.tsx') assert.ok(!/hasPermission\(/.test(source), `${f}: another permission check`);
  }
  assert.ok(read('_ReviewList.tsx').includes('if (canEdit) {'), 'the Action column exists only for the people who had the button');
});

test('the calendar\'s route is the Reviews page and nothing else; its address is kept', () => {
  const calendar = read('calendar/page.tsx');
  assert.ok(/export \{ default \} from '\.\.\/page';/.test(calendar));
  assert.ok(!/useRouter|router\.|redirect/.test(code(calendar)));
});

test('the page is built on the kit and the registry: the heading is the registry\'s name, dates are written by lib/format, the title is a link to the document', () => {
  const page = code(read('page.tsx'));
  assert.ok(page.includes("routeFor('/governance/reviews')"), 'the heading is the registry label');
  assert.ok(page.includes('variant="page"'));
  for (const f of files.filter((n) => /\.tsx$/.test(n))) {
    const source = code(read(f));
    assert.ok(!/\bslate-|\bbg-white\b|text-(xs|sm)\b|window\.location\.href/.test(source), `${f}: a platform-repainted class or a full reload`);
  }
  const parts = read('_parts.tsx');
  assert.ok(parts.includes('href={documentHref(id)}') && parts.includes('/governance/documents/${id}'), 'a title opens its document');
  assert.ok(read('_ReviewList.tsx').includes('formatDate(d.next_review_date, { calendar: true'), 'a review date is a calendar day');
  assert.ok(read('_ReviewList.tsx').includes('formatDate(d.last_reviewed_at)'), 'a completed-at time is a moment: the viewer\'s day');
});

test('the calendar\'s day is a real button with a name, a pressed state and a today marker, and the keys are moveDay\'s', () => {
  const calendar = code(read('_ReviewCalendar.tsx'));
  assert.ok(/<button[\s\S]*?type="button"[\s\S]*?data-review-day=\{cell\.key\}/.test(calendar));
  assert.ok(calendar.includes('aria-label={dayLabel(cell.key, list.length, { overdue, today: isToday })}'));
  assert.ok(calendar.includes('aria-pressed={picked}') && calendar.includes("aria-current={isToday ? 'date' : undefined}"));
  assert.ok(calendar.includes('moveDay(key, e.key)'));
  assert.ok(!/onClick=\{[^}]*\}[^>]*\bdiv\b|<div[^>]*onClick/.test(calendar), 'no div with a click handler');
  assert.ok(calendar.includes('role="grid"') && calendar.includes('role="gridcell"') && calendar.includes('role="columnheader"'));
  assert.ok(calendar.includes('md:hidden') && calendar.includes('agendaOf(days)'), 'below 768px the days with reviews are an agenda');
  assert.ok(calendar.includes("pickedHere.current") && calendar.includes('scrollIntoView'), 'the chosen day\'s reviews are scrolled into view and focused');
});
