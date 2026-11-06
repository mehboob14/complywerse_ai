// node --test "src/components/ui/ds/statModel.test.ts"
// StatTile and ProgressBar. The pure rules (a tile's four states, what a bar says about its value) are tested here; the markup they promise is read from
// source (there is no renderer in this repo). How they look was checked in a browser in the style guide, at 1440, 1024 and 390 px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from './kitRules.ts';
import { NOT_RECORDED, NO_ACCESS, barReading, tileState } from './statModel.ts';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const tileSource = read('src/components/ui/ds/StatTile.tsx');
const barSource = read('src/components/ui/ds/ProgressBar.tsx');
const tile = strip(tileSource);
const bar = strip(barSource);

// ── the tile's four states ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a figure is a figure only when the request answered and there is one', () => {
  assert.equal(tileState({ error: false, loading: false, value: '41' }), 'value');
  assert.equal(tileState({ error: false, loading: false, value: '0' }), 'value');            // "0" is a recorded figure
  assert.equal(tileState({ error: false, loading: false, value: '' }), 'value');             // text is the caller's: only null and undefined mean nothing
});

test('nothing recorded is its own state, never a 0', () => {
  assert.equal(tileState({ error: false, loading: false, value: null }), 'empty');
  assert.equal(tileState({ error: false, loading: false, value: undefined }), 'empty');
});

test('a wait and a failure come before the figure and before "Not recorded": a failed or pending request is not an empty one', () => {
  assert.equal(tileState({ error: false, loading: true, value: null }), 'loading');
  assert.equal(tileState({ error: false, loading: true, value: '41' }), 'loading');           // stale figure while it loads: the skeleton, not a number that may be wrong
  assert.equal(tileState({ error: true, loading: false, value: null }), 'error');
  assert.equal(tileState({ error: true, loading: false, value: '41' }), 'error');
});

test('both at once: the failure is said (with Retry) before the wait is shown', () => {
  assert.equal(tileState({ error: true, loading: true, value: null }), 'error');
});

test('a refusal is its own state and comes first: a person who may not see the figure is told so, never waited with, retried for or shown a number', () => {
  assert.equal(NO_ACCESS, 'No access');
  for (const error of [false, true]) {
    for (const loading of [false, true]) {
      for (const value of [null, undefined, '', '41', '0']) assert.equal(tileState({ denied: true, error, loading, value }), 'denied', JSON.stringify({ error, loading, value }));
    }
  }
});

test('a tile that never says `denied` is exactly as it was: the same four states in the same order', () => {
  assert.equal(tileState({ denied: false, error: true, loading: true, value: '41' }), 'error');
  assert.equal(tileState({ denied: false, error: false, loading: true, value: '41' }), 'loading');
  assert.equal(tileState({ denied: false, error: false, loading: false, value: null }), 'empty');
  assert.equal(tileState({ denied: false, error: false, loading: false, value: '41' }), 'value');
  assert.equal(tileState({ error: false, loading: false, value: '41' }), 'value');                // the argument may be left out altogether
});

// ── the bar ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a value in range fills that much and says it', () => {
  assert.deepEqual(barReading(72), { percent: 72, now: 72, text: '72%' });
  assert.deepEqual(barReading(0), { percent: 0, now: 0, text: '0%' });                         // 0 is a value: an empty bar that says 0%
  assert.deepEqual(barReading(100), { percent: 100, now: 100, text: '100%' });
  assert.deepEqual(barReading(7.5), { percent: 7.5, now: 8, text: '7.5%' });                   // one decimal only below 10, the words of formatPercent
  assert.deepEqual(barReading(33.4), { percent: 33.4, now: 33, text: '33%' });
});

test('a value outside 0-100 fills the track and no more, and the words still say what is stored', () => {
  assert.deepEqual(barReading(120), { percent: 100, now: 100, text: '120%' });
  assert.deepEqual(barReading(-5), { percent: 0, now: 0, text: '-5%' });
  assert.deepEqual(barReading(Number.POSITIVE_INFINITY), { percent: null, now: null, text: NOT_RECORDED });
});

test('nothing, a blank, text that is not a number and NaN are not recorded: no bar, never 0%', () => {
  for (const value of [null, undefined, '', '   ', 'abc', Number.NaN, {}, [], true]) {
    assert.deepEqual(barReading(value), { percent: null, now: null, text: NOT_RECORDED }, String(value));
  }
});

test('a number that arrives as text is read (a column that came back as a string)', () => {
  assert.deepEqual(barReading('45'), { percent: 45, now: 45, text: '45%' });
  assert.deepEqual(barReading(' 12.5 '), { percent: 12.5, now: 13, text: '13%' });
});

test('the caller can say it in its own words ("3 of 5 steps"); the bar is still drawn from the value', () => {
  assert.deepEqual(barReading(60, '3 of 5 steps'), { percent: 60, now: 60, text: '3 of 5 steps' });
  assert.deepEqual(barReading(60, '   '), { percent: 60, now: 60, text: '60%' });             // a blank is no words
  assert.equal(barReading(null, '3 of 5 steps').text, NOT_RECORDED);                           // no value: the words do not pretend there is one
});

// ── the markup they promise ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the bar is a real progressbar: a name, a range, a value and its words; the visible number is not read out twice', () => {
  assert.match(bar, /role="progressbar"/);
  assert.match(bar, /aria-label=\{label\}/);
  assert.match(bar, /aria-valuemin=\{0\}/);
  assert.match(bar, /aria-valuemax=\{100\}/);
  assert.match(bar, /aria-valuenow=\{bar\.now \?\? undefined\}/);
  assert.match(bar, /aria-valuetext=\{bar\.text\}/);
  assert.match(bar, /\{showValue && <span aria-hidden className="min-w-\[4ch\] shrink-0 whitespace-nowrap text-right text-ds-label tabular-nums text-ds-fg-body">\{bar\.text\}<\/span>\}/);
});

test('a bar with no value draws no bar: a dash, and "<label>: not recorded" for a screen reader', () => {
  assert.match(bar, /if \(bar\.percent === null\) \{/);
  assert.match(bar, /<span aria-hidden>\{EMPTY\}<\/span>/);
  assert.match(bar, /`\$\{label\}: \$\{NOT_RECORDED\.toLowerCase\(\)\}`/);
});

test('the bar is a 6px track with a rounded fill, and the fill colours are tokens', () => {
  assert.match(bar, /h-\[6px\] min-w-\[24px\] flex-1 overflow-hidden rounded-full bg-ds-border/);
  assert.match(bar, /style=\{\{ width: `\$\{bar\.percent\}%` \}\}/);
  assert.match(bar, /primary: 'bg-ds-primary', success: 'bg-ds-success', warning: 'bg-ds-warning', danger: 'bg-ds-danger'/);
});

test('the tile shows the right thing for each of its five states (a refusal first), in one place', () => {
  assert.match(tile, /const state = tileState\(\{ denied, error: error !== null, loading, value \}\);/);
  for (const s of ['denied', 'loading', 'error', 'empty', 'value']) assert.match(tile, new RegExp(`state === '${s}'`), s);
});

test('a refused figure says "No access" beside a lock (decoration), with the (i) next to those words saying why; the figure, the link and the bar are not drawn', () => {
  const denied = tile.slice(tile.indexOf("state === 'denied'"), tile.indexOf("state === 'loading'"));
  assert.match(denied, /<Lock aria-hidden className="h-\[14px\] w-\[14px\] shrink-0" strokeWidth=\{1\.75\} \/>/);
  assert.match(denied, /\{NO_ACCESS\}/);
  assert.match(denied, /\{info && <InfoTip text=\{info\} label=\{`Why \$\{label\.toLowerCase\(\)\} is not shown`\} \/>\}/);
  assert.doesNotMatch(denied, /\{value\}|<Link|ProgressBar|ErrorState|Skeleton/);
  assert.match(tile, /denied\?: boolean;/);
  assert.match(tile, /denied = false, loading = false, error = null/);                       // optional: every tile that never passes it is as it was
});

test('loading is announced and says what is loading; the skeleton blocks say nothing', () => {
  assert.match(tile, /<div role="status" aria-busy="true" className="mt-\[8px\] space-y-\[8px\]">/);
  assert.match(tile, /`Loading \$\{label\.toLowerCase\(\)\}`/);
});

test('a failure is an ErrorState (an alert with Retry), not a number', () => {
  assert.match(tile, /<ErrorState compact title=\{error\.title\} message=\{error\.message\} onRetry=\{error\.onRetry\} className="mt-\[4px\]" \/>/);
});

test('nothing recorded says "Not recorded" and puts the (i) next to those words, where the question comes up', () => {
  assert.match(tile, /\{NOT_RECORDED\}\s*\{info && <InfoTip text=\{info\} label=\{`Why \$\{label\.toLowerCase\(\)\} is not recorded`\} \/>\}/);
  assert.match(tile, /\{info && state === 'value' && <InfoTip text=\{info\} label=\{`About \$\{label\.toLowerCase\(\)\}`\} \/>\}/);       // with a figure it sits by the label
});

test('the figure is 24px on a 32px line, semibold, tabular; the label is 12px muted; a figure that is a link keeps its ring and a 24px target', () => {
  assert.match(tile, /const FIGURE = 'text-\[24px\] font-\[600\] leading-\[32px\] tabular-nums';/);
  assert.match(tile, /<p className="min-w-0 break-words text-ds-label text-ds-fg-muted">\{label\}<\/p>/);          // an explicit size on the <p>: the shell gives a bare one 11.5px
  assert.match(tile, /<p className=\{figure\}>\{value\}<\/p>/);
  assert.match(tile, /<Link href=\{link\.href\} aria-label=\{link\.label\} className=\{clsx\('w-fit min-w-\[24px\] rounded-ds-control hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring', figure\)\}>/);
  assert.match(tile, /const TILE = 'flex min-w-0 flex-col rounded-ds-card border border-ds-border bg-ds-surface p-\[16px\]';/);
});

test('a link must say where it goes: the label is part of the prop, not optional beside it', () => {
  assert.match(tile, /link\?: \{ href: string; label: string \};/);
});

test('the share bar under a figure is the progress bar, named by the tile and without a second number', () => {
  assert.match(tile, /\{progress != null && <ProgressBar value=\{progress\} label=\{label\} showValue=\{false\} className="mt-\[8px\]" \/>\}/);
});

test('the tones are tokens: danger for something wrong, success for something done', () => {
  assert.match(tile, /default: 'text-ds-fg', success: 'text-ds-success', warning: 'text-ds-warning', danger: 'text-ds-danger'/);
});

test('both follow the kit rules: tokens and arbitrary values only', () => {
  assert.deepEqual(findViolations(tileSource), []);
  assert.deepEqual(findViolations(barSource), []);
  assert.deepEqual(findViolations(read('src/components/ui/ds/statModel.ts')), []);
});

test('they are exported from the kit index and from the ui barrel', () => {
  const ds = read('src/components/ui/ds/index.ts');
  const ui = read('src/components/ui/index.ts');
  assert.match(ds, /export \{ StatTile, type StatTileProps, type StatTone \} from '\.\/StatTile';/);
  assert.match(ds, /export \{ ProgressBar, type ProgressBarProps, type ProgressTone \} from '\.\/ProgressBar';/);
  assert.match(ui, /export \{ StatTile, type StatTileProps, type StatTone \} from '\.\/ds\/StatTile';/);
  assert.match(ui, /export \{ ProgressBar, type ProgressBarProps, type ProgressTone \} from '\.\/ds\/ProgressBar';/);
});
