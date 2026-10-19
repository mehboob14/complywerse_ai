import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileKind, ncaName } from './_ncaName.ts';

test('a template shows the kind of file it is, not its raw file name', () => {
  assert.equal(fileKind('DCC Assessment and Compliance Tool V1.0xlsx.xlsx'), 'Excel');
  assert.equal(fileKind('Cryptography_Template_en-.docx'), 'Word');
  assert.equal(fileKind('Plan.PDF'), 'PDF');
  assert.equal(fileKind('notes.odt'), 'ODT');
  assert.equal(fileKind(''), '');
});

test('NCA names read as names, not file names', () => {
  const cases: [string, string][] = [
    ['anti Malware Protection', 'Anti Malware Protection'],
    ['Cryptography Template en', 'Cryptography'],
    ['Cybersecurity Organizational Structure Template en', 'Cybersecurity Organizational Structure'],
    ['DCC Assessment and Compliance Tool V1.0xlsx', 'DCC Assessment and Compliance Tool V1.0'],
    ['Cybersecurity risk management', 'Cybersecurity Risk Management'],
    ['Compliance With Cybersecurity Legislation And Regulations', 'Compliance with Cybersecurity Legislation and Regulations'],
    ['Workstations and Mobile Devices and BYOD Security', 'Workstations and Mobile Devices and BYOD Security'],
    ['Policy SSDLC Policy', 'SSDLC Policy'],
    ['REGISTER Vulnerability Register', 'Vulnerability Register'],
    ['Register Cybersecurity Audit Plan', 'Cybersecurity Audit Plan Register'],
    ['Report.docx', 'Report'],
    ['  Physical   Security (1) ', 'Physical Security'],
    ['EDR', 'EDR'],
  ];
  for (const [raw, name] of cases) assert.equal(ncaName(raw), name, raw);
});

test('a name that is already clean stays as it is', () => {
  for (const name of ['Identity and Access Management', 'OT ICS Security Standard', 'Key Performance Indicator Report']) assert.equal(ncaName(name), name);
});
