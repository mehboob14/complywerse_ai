// node --test "src/lib/navPages/riskAssessments.test.ts"
// The Risk Assessments pages in the navigation registry: each page that draws the kit head is flagged ownHeading and names itself as its registry entry does, the AI register is "AI System
// Risks" everywhere (the menu leaf, the tab, the forward), and the old addresses are registered as what they are (a forward) so nothing in the menu or the search points at a page that is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ownHeadingSection, routeFor, routes, titleFor } from '../navRegistry.ts';

const ROOT = fileURLToPath(new URL('../../app/(dashboard)/erm/risk-assessments/', import.meta.url));
const read = (rel: string): string => readFileSync(`${ROOT}${rel}`, 'utf8');

const HEADS: Array<[string, string, string]> = [
  ['/erm/risk-assessments', '_register/AssessmentRegister.tsx', 'Risk Assessments'],
  ['/erm/risk-assessments/:id', '[id]/page.tsx', 'Risk assessment'],
  ['/erm/risk-assessments/framework/:id', 'framework/[id]/page.tsx', 'Framework risk assessment'],
  ['/erm/risk-assessments/ai-risk-assessment', 'ai-risk-assessment/_ai/AiRegister.tsx', 'AI System Risks'],
];

test('each page that draws the kit head is flagged ownHeading, in the Risk Management section', () => {
  for (const [path, file, label] of HEADS) {
    assert.equal(routes.find((r) => r.path === path)?.ownHeading, true, `${path}: ownHeading`);
    assert.match(read(file), /<PageHeader[\s\S]{0,80}variant="page"/, `${file} renders PageHeader variant="page"`);
    assert.equal(ownHeadingSection(path.replace(':id', '12')), 'Risk Management', path);
    assert.equal(routes.find((r) => r.path === path)?.label, label, path);
  }
});

test('the home\'s heading is its registry name, and the AI register is called AI System Risks in the heading, the tab and the forward', () => {
  assert.equal(titleFor('/erm/risk-assessments'), 'Risk Assessments');
  assert.match(read('_register/AssessmentRegister.tsx'), /routeFor\('\/erm\/risk-assessments'\)\?\.label \?\? 'Risk Assessments'/);
  assert.match(read('ai-risk-assessment/_ai/AiRegister.tsx'), /routeFor\('\/erm\/risk-assessments\/ai-risk-assessment'\)\?\.label \?\? 'AI System Risks'/);
  assert.equal(routeFor('/erm/risk-assessments/ai-risk-assessment')?.label, 'AI System Risks');
  assert.equal(routeFor('/erm/ai-risk-assessment')?.label, 'AI System Risks');
  assert.match(read('[id]/page.tsx'), /title=\{a\.name\}/);
  assert.match(read('framework/[id]/page.tsx'), /title=\{a\.name\}/);
});

test('the old pages are registered as forwards and each really forwards', () => {
  const forwards: Array<[string, string, RegExp]> = [
    ['/erm/risk-assessments/dashboard', 'dashboard/page.tsx', /redirect\('\/erm\/risk-assessments\?view=insights'\)/],
    ['/erm/risk-assessments/list', 'list/page.tsx', /redirect\(`\/erm\/risk-assessments/],
    ['/erm/risk-assessments/framework', 'framework/page.tsx', /redirect\(searchParams\?\.tab === 'assigned'/],
    ['/erm/risk-assessments/:id/analytics', '[id]/analytics/page.tsx', /\?tab=insights/],
  ];
  for (const [path, file, rule] of forwards) {
    assert.ok(routes.some((r) => r.path === path), `${path} is in the registry`);
    assert.match(read(file), rule, file);
    assert.ok(read(file).split('\n').length < 25, `${file} is a forward, not a page`);
  }
  assert.equal(routes.find((r) => r.path === '/erm/risk-assessments/dashboard')?.aliasOf, '/erm/risk-assessments');
});
