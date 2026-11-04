import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countryOptions, frameworkItems, lawItems, regulatorItems, sub } from './setupCountry.ts';

const rows = [
  { code: 'PK', name: 'Pakistan', region: 'Asia', group: 'Main markets', flag: '/flags/pk.svg', aliases: ['Islamic Republic of Pakistan'], blocs: [] },
  { code: 'TR', name: 'Türkiye', region: 'Asia', group: 'Asia', flag: '/flags/tr.svg', aliases: ['Turkey'], blocs: [] },
];

const detail = {
  code: 'DE', name: 'Germany', region: 'Europe', flag: '/flags/de.svg',
  regulators: [
    { label: 'Federal Financial Supervisory Authority (BaFin)', area: 'Financial supervision', scope: 'country' as const },
    { label: 'Federal Office for Information Security (BSI)', area: 'Cybersecurity', scope: 'country' as const },
    { label: 'Deutsche Bundesbank', area: 'Banking', scope: 'country' as const },
    { label: 'European Securities and Markets Authority (ESMA)', area: 'Securities', scope: 'bloc' as const, bloc: 'EU' },
    { label: 'European Banking Authority (EBA)', area: 'Banking', scope: 'bloc' as const, bloc: 'EU' },
    { label: 'Financial Action Task Force (FATF)', area: 'AML/CFT', scope: 'international' as const },
  ],
  laws: [
    { label: 'Bundesdatenschutzgesetz (BDSG)', kind: 'Law', area: 'Data protection', scope: 'country' as const },
    { label: 'General Data Protection Regulation (GDPR)', kind: 'Regulation', area: 'Data protection', scope: 'bloc' as const, bloc: 'EU' },
    { label: 'ISO/IEC 27001:2022 Information security management systems', kind: 'Standard', area: 'Cybersecurity', scope: 'international' as const },
  ],
  frameworks: { applies: ['General Data Protection Regulation', 'NIS2 Directive'], widely_used: ['ISO/IEC 27001:2022'] },
};

test('the picker lists every country with its flag, its other names and its heading, and "Several countries" last', () => {
  const out = countryOptions(rows, []);
  assert.deepEqual(out[0], { value: 'Pakistan', label: 'Pakistan', group: 'Main markets', icon: '/flags/pk.svg', keywords: ['PK', 'Islamic Republic of Pakistan'] });
  assert.deepEqual(out[1].keywords, ['TR', 'Turkey']);                           // a search or an exact entry of "Turkey" finds Türkiye
  assert.deepEqual(out.at(-1), { value: 'Several countries', label: 'Several countries', group: 'Other' });
  assert.deepEqual(countryOptions(undefined, ['Pakistan', 'Qatar']), [{ value: 'Pakistan', label: 'Pakistan' }, { value: 'Qatar', label: 'Qatar' }]);   // an older server
});

test('what an item says about itself: its area, and where it comes from when that is not the country', () => {
  assert.equal(sub({ label: 'x', area: 'Banking', scope: 'country' }), 'Banking');
  assert.equal(sub({ label: 'x', area: 'Banking', scope: 'bloc', bloc: 'EU' }), 'EU · Banking');
  assert.equal(sub({ label: 'x', area: 'Privacy', kind: 'Law', scope: 'international' }), 'International · Law · Privacy');
});

test('the regulators: followed first, then the country\'s, then its bloc\'s, then the international bodies', () => {
  const out = regulatorItems({ followed: [{ label: 'Federal Financial Supervisory Authority (BaFin)', country: 'Germany' }, { label: 'SBP', country: 'Pakistan' }], country: 'Germany', detail });
  assert.deepEqual(out.map((i) => i.label), [
    'Federal Financial Supervisory Authority (BaFin)',                           // followed (and once: the country's own copy is dropped)
    'Deutsche Bundesbank', 'Federal Office for Information Security (BSI)',      // the country's: banking before cybersecurity
    'European Banking Authority (EBA)', 'European Securities and Markets Authority (ESMA)',
    'Financial Action Task Force (FATF)',
  ]);
  assert.equal(out[0].subLabel, 'Followed in Regulatory Feeds');
  assert.equal(out[3].subLabel, 'EU · Banking');
});

test('with no lists for the country the older list and the international bodies are offered', () => {
  const out = regulatorItems({ followed: [], country: 'Narnia', legacy: { Narnia: ['Lion Bank (LB)'] }, international: [{ label: 'Basel Committee on Banking Supervision (BCBS)', area: 'Banking', scope: 'international' }] });
  assert.deepEqual(out.map((i) => i.label), ['Lion Bank (LB)', 'Basel Committee on Banking Supervision (BCBS)']);
  assert.deepEqual(regulatorItems({ followed: [{ label: 'SBP', country: 'Pakistan' }], country: '' }).map((i) => i.label), ['SBP']);
});

test('the laws: the country\'s, its bloc\'s and the international ones, then the organisation\'s own register, each once', () => {
  const out = lawItems({ detail, register: [{ label: 'General Data Protection Regulation (GDPR)', detail: 'Register' }, { label: 'BPRD Circular 5', detail: 'SBP' }] });
  assert.deepEqual(out.map((i) => i.label), ['Bundesdatenschutzgesetz (BDSG)', 'General Data Protection Regulation (GDPR)', 'ISO/IEC 27001:2022 Information security management systems', 'BPRD Circular 5']);
  assert.equal(out[0].subLabel, 'Law · Data protection');
  assert.deepEqual(lawItems({ register: [], international: [{ label: 'FATF Recommendations', area: 'AML/CFT', kind: 'Standard', scope: 'international' }] }).map((i) => i.label), ['FATF Recommendations']);
});

test('the installed frameworks: the document\'s own, then those that apply in the country, then the widely used, then the rest', () => {
  const fw = [
    { id: 1, name: 'SOC 2 Type II', label: 'SOC 2 Type II (2017)' },
    { id: 2, name: 'ISO/IEC 27001:2022', label: 'ISO/IEC 27001:2022' },
    { id: 3, name: 'NIS2 Directive', label: 'NIS2 Directive (2022/2555)' },
    { id: 4, name: 'My own framework', label: 'My own framework' },
    { id: 5, name: 'General Data Protection Regulation', label: 'GDPR (2016/679)', of_document: true },
  ];
  const out = frameworkItems(fw, 'Germany', detail);
  assert.deepEqual(out.map((f) => [f.id, f.note]), [[5, 'This document’s'], [3, 'Applies in Germany'], [2, 'Widely used'], [1, ''], [4, '']]);   // the rest keep their order
  assert.deepEqual(frameworkItems(fw, '', undefined).map((f) => f.id), [5, 1, 2, 3, 4]);                                                      // no country: only the document's first
});
