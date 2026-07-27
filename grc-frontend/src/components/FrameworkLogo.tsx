'use client';

// Renders the real brand logo for a framework (ISO, PCI-DSS, SOC 2, NIST, …)
// pulled from the Clearbit logo CDN by the framework's owning-org domain, with
// a Google-favicon fallback and finally a clean initials badge if both fail or
// the framework has no known brand. No bundled assets, no broken <img> icons.

import { useState } from 'react';

// Order matters — most specific patterns first. Each framework maps to its
// owning organisation's domain; the logo is fetched from that domain so even
// regional / regulator frameworks show their real brand mark (favicon fallback).
const DOMAIN_RULES: Array<[RegExp, string]> = [
  // Corporate / sector frameworks (Clearbit has crisp logos for these)
  [/aramco/i, 'aramco.com'],
  [/sabic/i, 'sabic.com'],
  [/hitrust/i, 'hitrustalliance.net'],
  [/swift\s*cscf|customer security controls|\bswift\b/i, 'swift.com'],
  [/cobit|isaca/i, 'isaca.org'],
  // International standards & US frameworks
  [/pci|data security standard|dss/i, 'pcisecuritystandards.org'],
  [/soc\s*-?\s*2|soc2|aicpa|trust\s*service/i, 'aicpa.org'],
  [/sox|sarbanes|it general control/i, 'sec.gov'],
  [/iso|iec|27001|27002|27017|27018|9001|22301|20000|42001/i, 'iso.org'],
  [/nist|ai rmf|csf|800-?53|800-?171|cybersecurity framework/i, 'nist.gov'],
  [/cis\b|cis\s*control|critical security control|center for internet/i, 'cisecurity.org'],
  [/cmmc/i, 'cmmcab.org'],
  [/fedramp/i, 'fedramp.gov'],
  [/hipaa|hitech/i, 'hhs.gov'],
  // EU
  [/gdpr|general data protection/i, 'gdpr.eu'],
  [/dora|digital operational resilience/i, 'esma.europa.eu'],
  [/nis2|nis\s*2|enisa/i, 'enisa.europa.eu'],
  // Gulf / KSA / UAE / Qatar regulators
  [/sama\b|saudi arabian monetary/i, 'sama.gov.sa'],
  [/ndmo|national data management|personal data transfer|sdaia|\bnca\b|ecc/i, 'sdaia.gov.sa'],
  [/abu dhabi.*health|adhie|\bdoh\b/i, 'doh.gov.ae'],
  [/qatar central bank|\bqcb\b/i, 'qcb.gov.qa'],
  // Asia-Pacific
  [/\bmas\b|monetary authority of singapore/i, 'mas.gov.sg'],
  [/sbp|state bank of pakistan|etgrm|internet banking framework|cloud outsourcing/i, 'sbp.org.pk'],
  [/sri lanka|baseline security standard|\bbss\b/i, 'cert.gov.lk'],
  [/cps\s*234|apra/i, 'apra.gov.au'],
  [/csa\s*ccm|cloud security alliance/i, 'cloudsecurityalliance.org'],
];

function domainFor(name: string): string {
  for (const [re, domain] of DOMAIN_RULES) {
    if (re.test(name)) return domain;
  }
  return '';
}

function initials(name: string): string {
  const cleaned = (name || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) return (tokens[0][0] + tokens[1][0]).toUpperCase();
  return (cleaned.replace(/\s/g, '').slice(0, 3) || 'FW').toUpperCase();
}

export function FrameworkLogo({ name, size = 24, className = '' }: { name: string; size?: number; className?: string }) {
  const [stage, setStage] = useState<0 | 1 | 2>(0); // 0=clearbit, 1=favicon, 2=badge
  const domain = domainFor(name);

  if (!domain || stage === 2) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded bg-slate-100 font-bold text-slate-600 ${className}`}
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.36) }}
        aria-label={name}
        title={name}
      >
        {initials(name)}
      </span>
    );
  }

  const src = stage === 0
    ? `https://logo.clearbit.com/${domain}`
    : `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;

  return (
    <img
      src={src}
      alt={name}
      title={name}
      width={size}
      height={size}
      className={`shrink-0 rounded object-contain ${className}`}
      style={{ width: size, height: size }}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setStage((s) => (s + 1) as 0 | 1 | 2)}
    />
  );
}
