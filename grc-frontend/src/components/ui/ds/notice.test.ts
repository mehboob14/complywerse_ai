// node --test "src/components/ui/ds/notice.test.ts"
// Notice: the banner above a list or a card. Its one decision (the live-region role of a tone) is pure and tested here; the markup it promises is
// read from source (there is no renderer in this repo); how it looks was checked in a browser against the three pages that already show it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from './kitRules.ts';
import { noticeRole } from './noticeModel.ts';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const source = read('src/components/ui/ds/Notice.tsx');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

test('information is polite, a warning and a danger are assertive', () => {
  assert.equal(noticeRole('info'), 'status');
  assert.equal(noticeRole('warning'), 'alert');
  assert.equal(noticeRole('danger'), 'alert');
});

test('a page can ask for the other role: a warning that is on the page from the start is a status', () => {
  assert.equal(noticeRole('warning', 'status'), 'status');
  assert.equal(noticeRole('danger', 'status'), 'status');
  assert.equal(noticeRole('info', 'alert'), 'alert');
  assert.equal(noticeRole('info', undefined), 'status');
});

test('the banner speaks with the role the model decides, in a flex row that wraps so an action can drop under the words', () => {
  assert.match(code, /<div role=\{noticeRole\(tone, role\)\} className=\{clsx\('flex flex-wrap items-start /);
  assert.match(code, /basis-\[12rem\]/);                                   // the icon and the words ask for 12rem: a long action wraps instead of squeezing them
  assert.match(code, /\{action && <div className="shrink-0">\{action\}<\/div>\}/);
});

test('each tone has its tint, its icon colour and a mark of its own (never colour alone)', () => {
  assert.match(code, /info: \{ box: 'border-ds-border bg-ds-info-soft', icon: 'text-ds-info', Icon: Info \}/);
  assert.match(code, /warning: \{ box: 'border-ds-border bg-ds-warning-soft', icon: 'text-ds-warning', Icon: AlertTriangle \}/);
  assert.match(code, /danger: \{ box: 'border-ds-danger-border bg-ds-danger-soft', icon: 'text-ds-danger', Icon: AlertCircle \}/);
  assert.match(code, /<Icon aria-hidden /);                                // the icon is a mark: the words say it
});

test('a notice with no title, no line and no action says nothing at all', () => {
  assert.match(code, /if \(!title && !hasLine && !action\) return null;/);
  assert.match(code, /children !== undefined && children !== null && children !== false && children !== ''/);
});

test('it follows the kit rules: tokens and arbitrary values only', () => {
  assert.deepEqual(findViolations(source), []);
});

test('the title is bold and the line is the body colour, both wrapping anywhere (a long word cannot widen the page)', () => {
  assert.match(code, /<p className="text-ds-body font-\[600\] text-ds-fg \[overflow-wrap:anywhere\]">\{title\}<\/p>/);
  assert.match(code, /<div className="text-ds-body text-ds-fg-body \[overflow-wrap:anywhere\]">\{children\}<\/div>/);
});

test('it is exported from the kit index and from the ui barrel', () => {
  assert.match(read('src/components/ui/ds/index.ts'), /export \{ Notice, type NoticeProps, type NoticeTone \} from '\.\/Notice';/);
  assert.match(read('src/components/ui/index.ts'), /export \{ Notice, type NoticeProps, type NoticeTone \} from '\.\/ds\/Notice';/);
});

// ListNotice was the Governance registers' own copy; it stays as a wrapper so the three pages that import it keep their words and their look.
test('ListNotice is a thin wrapper: the warning tone, the info icon and the polite role it always had', () => {
  const wrapper = read('src/components/governance/ListNotice.tsx');
  assert.match(wrapper, /import \{ Notice \} from '@\/components\/ui\/ds\/Notice';/);
  assert.match(wrapper, /<Notice tone="warning" role="status" icon=\{Info\} title=\{title\}>\{children\}<\/Notice>/);
  assert.match(wrapper, /export function ListNotice\(\{ title, children \}: \{ title: string; children\?: ReactNode \}\)/);        // the props every caller passes
  assert.doesNotMatch(wrapper, /className=/, 'no markup of its own');
});

test('the warning tone draws exactly what ListNotice drew: the same frame, padding, gap, tint and icon', () => {
  for (const cls of ['gap-[8px]', 'rounded-ds-card', 'border-ds-border', 'bg-ds-warning-soft', 'px-[12px]', 'py-[8px]', 'mt-[2px]', 'h-[16px]', 'w-[16px]', 'shrink-0', 'text-ds-warning']) {
    assert.ok(code.includes(cls), cls);
  }
});

test('the three pages that show a ListNotice still import it by its old path', () => {
  for (const page of [
    'src/app/(dashboard)/governance/exceptions/page.tsx',
    'src/app/(dashboard)/governance/documents/attestation/page.tsx',
    'src/app/(dashboard)/governance/committees/[id]/page.tsx',
  ]) assert.match(read(page), /import \{ ListNotice \} from '@\/components\/governance\/ListNotice';/, page);
});
