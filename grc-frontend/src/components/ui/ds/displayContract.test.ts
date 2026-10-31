// node --test "src/components/ui/ds/displayContract.test.ts"
// Source-text contract (like kitGuard.test.ts) for the display components: StatusPill, Avatar, PersonChip, PersonStack, EmptyState, ErrorState
// and Skeleton. There is no React renderer in this repo, so what a component promises to always draw, to hide from a screen reader, or to
// announce is pinned in its source; the logic behind them (status.ts, people.ts, popoverSpot.ts) has its own tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (url: string): string => readFileSync(new URL(url, import.meta.url), 'utf8');
/** the code without its comments */
const code = (name: string): string => read(`./${name}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

test('StatusPill always draws its label; the dot is decoration; the title appears only when the label is cut', () => {
  const pill = code('StatusPill.tsx');
  assert.match(pill, /const text = label\.trim\(\) \|\| EMPTY;/);                 // a blank label is the dash, never nothing
  assert.match(pill, /<span ref=\{word\} className="min-w-0 truncate">\{text\}<\/span>/);
  assert.doesNotMatch(pill, /return null|label\s*(&&|\?)|(?:hide|show)Label|iconOnly|dotOnly|children/i);
  assert.match(pill, /<span aria-hidden className="h-\[6px\] w-\[6px\][^"]*"/);
  assert.match(pill, /title=\{clipped \? text : undefined\}/);
  assert.match(pill, /TONE\[tone\] \?\? TONE\.neutral/);                    // a tone nobody defined reads as neutral, it does not crash
});

test('the display components take their colours from the tone table: no hex of their own', () => {
  for (const file of ['StatusPill.tsx', 'Avatar.tsx', 'PersonChip.tsx', 'PersonStack.tsx', 'EmptyState.tsx', 'ErrorState.tsx', 'Skeleton.tsx']) {
    assert.doesNotMatch(code(file), /#[0-9a-f]{3,8}\b/i, file);
  }
});

test('Avatar: alone it is an image named for the person; beside a name, or without one, it is hidden; text never under 12px', () => {
  const avatar = code('Avatar.tsx');
  assert.match(avatar, /decorative \|\| !who \? \{ 'aria-hidden': true \} : \{ role: 'img', 'aria-label': who \}/);
  assert.match(avatar, /initials\(who, size === 20 \? 1 : 2\)/);             // one letter in the 20px circle: two would need under 12px type
  assert.match(avatar, /20: 'h-\[20px\] w-\[20px\]'[\s\S]*24: 'h-\[24px\] w-\[24px\]'[\s\S]*32: 'h-\[32px\] w-\[32px\]'/);
  assert.doesNotMatch(avatar, /fontSize/);
});

test('PersonChip: the avatar is decoration beside the name, a missing person reads "Unassigned", a cut name keeps its full text in a title', () => {
  const chip = code('PersonChip.tsx');
  assert.match(chip, /<Avatar name=\{who\} size=\{size\} decorative \/>/);
  assert.match(chip, /emptyLabel = UNASSIGNED/);
  assert.match(chip, /min-w-0 truncate/);
  assert.match(chip, /title=\{clipped \? who : undefined\}/);
});

test('PersonStack: a real button for the rest, named with their names, that opens a list; Escape closes it and gives focus back', () => {
  const stack = code('PersonStack.tsx');
  assert.match(stack, /<button\s+ref=\{button\}\s+type="button"\s+aria-label=\{moreLabel\}\s+aria-expanded=\{open\}/);
  assert.match(stack, /personStack\(people, max\)/);
  assert.match(stack, /e\.key === 'Escape'\) \{ close\(\); button\.current\?\.focus\(\)/);
  assert.match(stack, /createPortal\(/);                                      // drawn on the window, so a table or card never clips it
  assert.match(stack, /min-w-\[24px\]/);                                      // WCAG 2.2 target size, also beside 20px avatars
  assert.match(code('../../../lib/people.ts'), /moreCount\(named, max\)/);   // the split is lib/format's moreCount
});

test('EmptyState: first use and no matches; at most three tips; "Clear filters" only when nothing matches and a page can clear them', () => {
  const empty = code('EmptyState.tsx');
  assert.match(empty, /type EmptyStateKind = 'noMatches' \| 'firstUse'/);
  assert.match(empty, /MAX_TIPS = 3/);
  assert.match(empty, /\.slice\(0, MAX_TIPS\)/);
  assert.match(empty, /kind === 'noMatches' \? onClearFilters : undefined/);
  assert.match(empty, />Clear filters<\/button>/);
});

test('ErrorState is an alert; Retry appears only when a page can retry; compact is a row for the inside of a card', () => {
  const error = code('ErrorState.tsx');
  assert.equal((error.match(/role="alert"/g) ?? []).length, 2);               // the framed state and the compact row
  assert.match(error, /const retry = onRetry && \(/);
  assert.match(error, /Retry\s*<\/button>/);
  assert.match(error, /compact = false/);
});

test('Skeleton: the blocks are hidden, the wrapper announces "Loading" once and is busy', () => {
  const skeleton = code('Skeleton.tsx');
  assert.match(skeleton, /<div aria-hidden className=\{clsx\('animate-pulse /);
  assert.match(skeleton, /<div role="status" aria-busy="true" className=\{clsx\('relative', className\)\}>\s*<span className="sr-only">\{label\}<\/span>/);
  assert.equal((skeleton.match(/label = 'Loading'/g) ?? []).length, 2);       // SkeletonLines and SkeletonRows
  assert.match(skeleton, /export function SkeletonLines/);
  assert.match(skeleton, /export function SkeletonRows/);
});

test('the barrels export every display component', () => {
  const names = ['StatusPill', 'Avatar', 'PersonChip', 'PersonStack', 'EmptyState', 'ErrorState', 'Skeleton', 'SkeletonLines', 'SkeletonRows'];
  for (const barrel of ['./index.ts', '../index.ts']) {
    const text = read(barrel);
    for (const name of names) assert.match(text, new RegExp(`export \\{[^}]*\\b${name}\\b[^}]*\\} from '\\./(?:ds/)?[A-Za-z]+'`), `${barrel} lacks ${name}`);
  }
});
