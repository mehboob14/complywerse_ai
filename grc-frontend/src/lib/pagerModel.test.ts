// node --test "src/lib/pagerModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PAGE_SIZES, pageRange, pageSizeOptions, rangeText } from './pagerModel.ts';

const at = (page: number, size: number, total: number) => pageRange(page, size, total);
const text = (page: number, size: number, total: number, noun = 'documents') => rangeText(at(page, size, total), total, noun);

test('the first page of many', () => {
  assert.deepEqual(at(1, 25, 1243), { page: 1, pages: 50, from: 1, to: 25, hasPrev: false, hasNext: true });
});

test('a middle page', () => {
  assert.deepEqual(at(2, 25, 1243), { page: 2, pages: 50, from: 26, to: 50, hasPrev: true, hasNext: true });
});

test('the last page is partial, and ends at the true total', () => {
  assert.deepEqual(at(50, 25, 1243), { page: 50, pages: 50, from: 1226, to: 1243, hasPrev: true, hasNext: false });
});

test('the last page can be full; one item over makes one more page', () => {
  assert.deepEqual(at(4, 25, 100), { page: 4, pages: 4, from: 76, to: 100, hasPrev: true, hasNext: false });
  assert.deepEqual(at(5, 25, 101), { page: 5, pages: 5, from: 101, to: 101, hasPrev: true, hasNext: false });
});

test('everything on one page: no neighbours', () => {
  assert.deepEqual(at(1, 25, 8), { page: 1, pages: 1, from: 1, to: 8, hasPrev: false, hasNext: false });
  assert.deepEqual(at(1, 25, 25), { page: 1, pages: 1, from: 1, to: 25, hasPrev: false, hasNext: false });
});

test('nothing at all: page 1 of 1, from 0 to 0', () => {
  assert.deepEqual(at(1, 25, 0), { page: 1, pages: 1, from: 0, to: 0, hasPrev: false, hasNext: false });
  assert.deepEqual(at(7, 25, 0), { page: 1, pages: 1, from: 0, to: 0, hasPrev: false, hasNext: false });
});

test('a page outside the range is clamped into it', () => {
  assert.equal(at(9, 25, 60).page, 3);
  assert.deepEqual(at(9, 25, 60), { page: 3, pages: 3, from: 51, to: 60, hasPrev: true, hasNext: false });
  assert.equal(at(0, 25, 60).page, 1);
  assert.equal(at(-4, 25, 60).page, 1);
  assert.equal(at(2.9, 25, 60).page, 2);
  assert.equal(at(NaN, 25, 60).page, 1);
  assert.equal(at(Infinity, 25, 60).page, 1);
});

test('a page size of 0, a negative one or one that is not a number puts everything on one page instead of dividing by zero', () => {
  for (const size of [0, -10, NaN, Infinity, 0.5]) assert.deepEqual(at(1, size, 40), { page: 1, pages: 1, from: 1, to: 40, hasPrev: false, hasNext: false }, String(size));
  assert.deepEqual(at(3, 0, 0), { page: 1, pages: 1, from: 0, to: 0, hasPrev: false, hasNext: false });
});

test('a total that is negative or not a number is none; a fraction is rounded down', () => {
  for (const total of [-5, NaN, Infinity]) assert.deepEqual(at(1, 25, total), { page: 1, pages: 1, from: 0, to: 0, hasPrev: false, hasNext: false }, String(total));
  assert.deepEqual(at(1, 25, 12.9), { page: 1, pages: 1, from: 1, to: 12, hasPrev: false, hasNext: false });
});

test('a page size of 1 pages through one item at a time', () => {
  assert.deepEqual(at(3, 1, 5), { page: 3, pages: 5, from: 3, to: 3, hasPrev: true, hasNext: true });
});

test('the words: "1–25 of 1,243 documents" with thousands separators and an en dash', () => {
  assert.equal(text(1, 25, 1243), '1–25 of 1,243 documents');
  assert.equal(text(50, 25, 1243), '1,226–1,243 of 1,243 documents');
  assert.equal(text(2, 25, 1243, 'vendors'), '26–50 of 1,243 vendors');
  assert.equal(text(1, 25, 8), '1–8 of 8 documents');
  assert.equal(text(1, 25, 1), '1–1 of 1 documents');
});

test('the words when there is nothing', () => {
  assert.equal(text(1, 25, 0), '0 documents');
  assert.equal(text(1, 25, NaN), '0 documents');
});

test('the true total is what is printed, not the size of the page that came back', () => {
  const capped = Array.from({ length: 100 }, (_, i) => i);                         // the API sent 100 of 1,243
  assert.equal(text(1, 100, 1243), '1–100 of 1,243 documents');
  assert.notEqual(text(1, 100, capped.length), text(1, 100, 1243));
});

test('page sizes on offer: ascending, no repeats, the size in use is always among them', () => {
  assert.deepEqual(pageSizeOptions(), [10, 25, 50, 100]);
  assert.deepEqual(pageSizeOptions(undefined, 25), [10, 25, 50, 100]);
  assert.deepEqual(pageSizeOptions(undefined, 30), [10, 25, 30, 50, 100]);
  assert.deepEqual(pageSizeOptions([50, 10, 10, 20], 20), [10, 20, 50]);
  assert.deepEqual(pageSizeOptions([25, 0, -1, NaN], 5), [5, 25]);
  assert.deepEqual(DEFAULT_PAGE_SIZES, [10, 25, 50, 100]);
});
