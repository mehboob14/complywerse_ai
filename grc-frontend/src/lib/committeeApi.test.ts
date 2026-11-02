// node --test src/lib/committeeApi.test.ts
// The committee calls of the API client against the router that serves them. `updateMinutes` once pointed at /governance/committees/minutes/{id}, a path the
// router has never had (it serves /governance/committees/meetings/minutes/{id}); nothing noticed because no screen called it. This reads the client and the
// router (backend/grc/modules/governance/routers/committees.py, next to this folder in the repository) and checks that every committeeApi call is a route the
// server serves, with the same method, and that the new life-cycle calls are there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const api = readFileSync('src/lib/api.ts', 'utf8').replace(/\r\n/g, '\n');
const committeeApi = api.slice(api.indexOf('export const committeeApi = {'), api.indexOf('export interface QuickAssessRequest'));
const ROUTER = '../backend/grc/modules/governance/routers/committees.py';

/** [METHOD, path] of every committee endpoint a committeeApi function calls, a ${id} written as {}. */
const calls = Array.from(committeeApi.matchAll(/([`'"])(\/governance\/committees[^`'"]*)\1/g)).map((lit) => {
  const before = committeeApi.slice(0, lit.index);
  const method = Array.from(before.matchAll(/apiClient\.(get|post|put|patch|delete)\b/g)).pop()?.[1] ?? '';
  return `${method.toUpperCase()} ${lit[2].replace(/\$\{[^}]*\}/g, '{}')}`;
});

test('updateMinutes points at the path the router serves', () => {
  assert.match(committeeApi, /updateMinutes: \(minutesId: number, data: any\) => apiClient\.put\(`\/governance\/committees\/meetings\/minutes\/\$\{minutesId\}`, data\)/);
  assert.ok(calls.includes('PUT /governance/committees/meetings/minutes/{}'));
  assert.ok(!calls.includes('PUT /governance/committees/minutes/{}'), 'the old path is gone');
});

test('every committeeApi call is a route the committees router serves, with its method', { skip: !existsSync(ROUTER) && 'the backend folder is not beside the frontend here' }, () => {
  const router = readFileSync(ROUTER, 'utf8');
  const served = new Set(Array.from(router.matchAll(/@router\.(get|post|put|patch|delete)\(\s*"([^"]*)"/g)).map(
    (r) => `${r[1].toUpperCase()} /governance/committees${r[2]}`.replace(/\{[^}]*\}/g, '{}')));
  assert.ok(calls.length >= 40, `only ${calls.length} calls found: the pattern that reads them is broken`);
  assert.deepEqual(calls.filter((c) => !served.has(c)), [], 'a committeeApi call has no route');
});

test('the meeting life cycle, the roll, the outcome and the decisions feed are called on their routes', () => {
  for (const call of [
    'POST /governance/committees/meetings/{}/start', 'POST /governance/committees/meetings/{}/end',
    'GET /governance/committees/meetings/{}/attendance', 'PUT /governance/committees/meetings/{}/attendance',
    'PUT /governance/committees/meetings/agenda/{}/outcome', 'GET /governance/committees/decisions',
  ]) assert.ok(calls.includes(call), `${call} is not called`);
  for (const name of ['startMeeting', 'endMeeting', 'getAttendance', 'saveAttendance', 'recordAgendaOutcome', 'listDecisions']) {
    assert.match(committeeApi, new RegExp(`\\n  ${name}: `), `${name} is missing`);
  }
  // the roll goes as { members: [{ user_id, status }] }; the list calls pass their params straight through
  assert.match(committeeApi, /apiClient\.put\(`\/governance\/committees\/meetings\/\$\{meetingId\}\/attendance`, \{ members \}\)/);
  assert.match(committeeApi, /apiClient\.get\('\/governance\/committees\/decisions', \{ params \}\)/);
  assert.match(committeeApi, /apiClient\.get\('\/governance\/committees\/actions', \{ params \}\)/);
  assert.match(committeeApi, /assigned_to\?: number \| 'me'; due_after\?: string; due_before\?: string/);
});

test('no screen outside Cybersecurity Assurance still calls the old minutes path', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? (name === 'cyber-assurance' ? [] : walk(path)) : /\.tsx?$/.test(name) ? [path] : [];
  });
  const found = walk('src').filter((path) => !path.endsWith('.test.ts') && /['"`]\/governance\/committees\/minutes\//.test(readFileSync(path, 'utf8')));
  assert.deepEqual(found, []);
});
