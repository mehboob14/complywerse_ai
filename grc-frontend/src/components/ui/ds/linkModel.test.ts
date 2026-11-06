// node --test "src/components/ui/ds/linkModel.test.ts"
// The classes of a link in text and of a card that is a link: the 24px target (44px on a phone) that moves nothing, the three colours, the ring, and the
// kit rules (only tokens and arbitrary values).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findViolations } from './kitRules.ts';
import { CARD_LINK, CARD_LINK_PADDING, linkClasses, type LinkSize, type LinkTone } from './linkModel.ts';

const has = (classes: string, one: string): boolean => classes.split(' ').includes(one);

test('a line of 13px text is made a 24px target by 2px of padding that a negative margin cancels; on a phone 12px that is cancelled the same way (44px)', () => {
  const c = linkClasses({ size: 'body' });
  for (const one of ['py-[2px]', '-my-[2px]', 'max-md:py-[12px]', 'max-md:-my-[12px]']) assert.ok(has(c, one), one);
  assert.equal(20 + 2 * 2, 24);
  assert.equal(20 + 2 * 12, 44);
});

test('a line of 12px text is 16px high, so its padding is 4px (24px) and 14px on a phone (44px), cancelled the same way', () => {
  const c = linkClasses({ size: 'label' });
  for (const one of ['py-[4px]', '-my-[4px]', 'max-md:py-[14px]', 'max-md:-my-[14px]']) assert.ok(has(c, one), one);
  assert.equal(16 + 2 * 4, 24);
  assert.equal(16 + 2 * 14, 44);
});

test('the padding and the margin of every size are the same amount, so no link moves the line it sits in', () => {
  for (const size of ['body', 'label'] as LinkSize[]) {
    const parts = linkClasses({ size }).split(' ');
    const take = (re: RegExp) => parts.map((p) => re.exec(p)).filter(Boolean).map((m) => Number(m![1]));
    assert.deepEqual(take(/^py-\[(\d+)px\]$/), take(/^-my-\[(\d+)px\]$/), size);
    assert.deepEqual(take(/^max-md:py-\[(\d+)px\]$/), take(/^max-md:-my-\[(\d+)px\]$/), size);
  }
});

test('the three colours: a title is dark and goes to the brand colour on hover, a link in text is the brand colour, a muted link is grey until hovered', () => {
  const title = linkClasses({ tone: 'title' });
  assert.ok(has(title, 'text-ds-fg') && has(title, 'hover:text-ds-primary-text') && has(title, 'font-medium'));
  const text = linkClasses({ tone: 'text' });
  assert.ok(has(text, 'text-ds-primary-text') && has(text, 'font-medium') && !has(text, 'hover:text-ds-primary-text'));
  const muted = linkClasses({ tone: 'muted' });
  assert.ok(has(muted, 'text-ds-fg-muted') && has(muted, 'hover:text-ds-primary-text') && !has(muted, 'font-medium'));
  for (const tone of ['title', 'text', 'muted'] as LinkTone[]) assert.ok(has(linkClasses({ tone }), 'hover:underline'), tone);
});

test('the default is the title link in a 13px line, and every link has the ring on itself and a rounded corner for it', () => {
  assert.equal(linkClasses(), linkClasses({ tone: 'title', size: 'body' }));
  for (const tone of ['title', 'text', 'muted'] as LinkTone[]) for (const size of ['body', 'label'] as LinkSize[]) {
    const c = linkClasses({ tone, size });
    assert.ok(has(c, 'focus-visible:outline-none') && has(c, 'focus-visible:shadow-ds-ring') && has(c, 'rounded-ds-control'), `${tone}/${size}`);
  }
});

test('the four links the first wave wrote by hand are these combinations: a title, a link in a sentence, a muted link, a label link', () => {
  const same = (a: string, b: string) => assert.deepEqual(a.split(' ').sort(), b.split(' ').sort());
  same(linkClasses({ tone: 'title', size: 'body' }), 'rounded-ds-control py-[2px] -my-[2px] max-md:py-[12px] max-md:-my-[12px] font-medium text-ds-fg underline-offset-[2px] hover:text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring');
  same(linkClasses({ tone: 'text', size: 'body' }), 'rounded-ds-control py-[2px] -my-[2px] max-md:py-[12px] max-md:-my-[12px] font-medium text-ds-primary-text underline-offset-[2px] hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring');
  same(linkClasses({ tone: 'muted', size: 'label' }), 'rounded-ds-control py-[4px] -my-[4px] max-md:py-[14px] max-md:-my-[14px] underline-offset-[2px] focus-visible:outline-none focus-visible:shadow-ds-ring text-ds-fg-muted hover:text-ds-primary-text hover:underline');
  same(linkClasses({ tone: 'text', size: 'label' }), 'rounded-ds-control py-[4px] -my-[4px] max-md:py-[14px] max-md:-my-[14px] underline-offset-[2px] focus-visible:outline-none focus-visible:shadow-ds-ring font-medium text-ds-primary-text hover:underline');
});

test('a card link is a block with the card box, a hover that says it presses, and the ring on the card itself', () => {
  for (const one of ['block', 'rounded-ds-card', 'border', 'border-ds-border', 'bg-ds-surface', 'hover:border-ds-border-strong', 'focus-visible:shadow-ds-ring', 'focus-visible:outline-none']) assert.ok(has(CARD_LINK, one), one);
  assert.equal(CARD_LINK_PADDING, 'p-[16px]');
});

test('every class here follows the kit rules: tokens and arbitrary values only', () => {
  const all = [CARD_LINK, CARD_LINK_PADDING, ...(['title', 'text', 'muted'] as LinkTone[]).flatMap((tone) => (['body', 'label'] as LinkSize[]).map((size) => linkClasses({ tone, size })))];
  for (const classes of all) assert.deepEqual(findViolations(`<a className="${classes}">`), [], classes);
});
