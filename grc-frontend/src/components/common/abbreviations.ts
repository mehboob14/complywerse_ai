/**
 * Glossary of GRC + security abbreviations used across the platform.
 *
 * Each entry is a short, factual definition written from general industry
 * knowledge. The shape is intentionally tiny so the data can be embedded
 * inline next to any acronym via the `<Abbr>` component.
 *
 * Keys are uppercase (case-insensitive lookup is the component's job).
 */

export interface AbbreviationEntry {
  /** Expanded full name, e.g. "Common Vulnerabilities and Exposures". */
  full: string;
  /** One-to-two-sentence plain-language description for the tooltip body. */
  blurb: string;
  /** Optional sourced-from label (regulator / standards body / vendor). */
  source?: string;
  /** Optional canonical reference URL — surfaced as a "learn more" link. */
  href?: string;
}

export const ABBREVIATIONS: Record<string, AbbreviationEntry> = {
  // ── Vulnerability identifiers ──────────────────────────────────────────────
  CVE: {
    full: 'Common Vulnerabilities and Exposures',
    blurb:
      'Public identifier assigned to a specific software flaw, e.g. CVE-2024-1234. Used as the universal key for cross-referencing the same vulnerability across vendors and scanners.',
    source: 'MITRE',
    href: 'https://www.cve.org/',
  },
  CWE: {
    full: 'Common Weakness Enumeration',
    blurb:
      'Catalogue of weakness types (e.g. CWE-79 cross-site scripting, CWE-89 SQL injection). Tells you the *class* of mistake; CVE tells you the specific instance.',
    source: 'MITRE',
    href: 'https://cwe.mitre.org/',
  },
  CPE: {
    full: 'Common Platform Enumeration',
    blurb:
      'Structured naming scheme for products and versions, e.g. cpe:/a:apache:tomcat:9.0.41. Lets a CVE be matched to the exact software install it affects.',
    source: 'NIST',
  },

  // ── Vulnerability scoring & prioritisation ─────────────────────────────────
  CVSS: {
    full: 'Common Vulnerability Scoring System',
    blurb:
      'Industry-standard 0.0–10.0 severity score derived from a vulnerability’s attack vector, complexity, privileges, and impact. The headline severity number on most advisories.',
    source: 'FIRST.org',
    href: 'https://www.first.org/cvss/',
  },
  EPSS: {
    full: 'Exploit Prediction Scoring System',
    blurb:
      'Probability (0–100%) that a given CVE will be exploited in the wild in the next 30 days, computed from observed exploit activity. Complements CVSS — high CVSS does not always mean high EPSS.',
    source: 'FIRST.org',
    href: 'https://www.first.org/epss/',
  },
  KEV: {
    full: 'Known Exploited Vulnerabilities',
    blurb:
      'Catalogue maintained by CISA of CVEs confirmed to be actively used in real-world attacks. A vulnerability on the KEV list is no longer theoretical — it is being weaponised right now.',
    source: 'CISA',
    href: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
  },
  SSVC: {
    full: 'Stakeholder-Specific Vulnerability Categorization',
    blurb:
      'Decision-tree approach to remediation prioritisation that combines exploitation status, technical impact, and mission impact into an action (Track / Attend / Act).',
    source: 'CISA / CERT',
  },

  // ── Data sources & authorities ─────────────────────────────────────────────
  CISA: {
    full: 'Cybersecurity and Infrastructure Security Agency',
    blurb:
      'US federal agency that maintains the KEV catalogue, publishes alerts on active exploitation, and issues binding directives for federal systems.',
    href: 'https://www.cisa.gov/',
  },
  NVD: {
    full: 'National Vulnerability Database',
    blurb:
      'US government repository of CVE records with CVSS scores, CPE mappings, and references. The canonical enrichment source most vuln scanners pull from.',
    source: 'NIST',
    href: 'https://nvd.nist.gov/',
  },
  MSRC: {
    full: 'Microsoft Security Response Center',
    blurb:
      'Microsoft’s vulnerability disclosure programme — publishes monthly Patch Tuesday advisories, KB references, and exploited-in-the-wild flags for Microsoft products.',
    source: 'Microsoft',
    href: 'https://msrc.microsoft.com/',
  },
  FIRST: {
    full: 'Forum of Incident Response and Security Teams',
    blurb:
      'International body that maintains the CVSS and EPSS standards used to score and prioritise vulnerabilities.',
    href: 'https://www.first.org/',
  },
  NIST: {
    full: 'National Institute of Standards and Technology',
    blurb:
      'US standards body responsible for NVD, the Cybersecurity Framework (CSF), SP 800-series guidance, and many other foundational security publications.',
    href: 'https://www.nist.gov/',
  },

  // ── Operational / remediation terms ────────────────────────────────────────
  PoC: {
    full: 'Proof of Concept',
    blurb:
      'Working code or demonstration that proves a vulnerability is exploitable. The existence of a public PoC sharply raises the urgency of patching.',
  },
  SLA: {
    full: 'Service Level Agreement',
    blurb:
      'Time-bound commitment for resolving a finding, usually graduated by severity (e.g. Critical 14 days, High 30 days). Tracked here as time-to-remediate vs the target.',
  },
  MTTR: {
    full: 'Mean Time To Remediate',
    blurb:
      'Average number of days between a vulnerability being detected and being closed. Lower is better; trending matters more than the absolute value.',
  },
};

/** Lookup helper — case-insensitive, returns null when the term isn't known. */
export function lookupAbbreviation(code: string | null | undefined): AbbreviationEntry | null {
  if (!code) return null;
  const key = code.trim().toUpperCase();
  return ABBREVIATIONS[key] ?? null;
}
