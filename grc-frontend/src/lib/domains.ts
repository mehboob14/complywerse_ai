import psl from 'psl';

/**
 * Registrable ("apex") domain for a hostname, resolved via the full Public
 * Suffix List (the `psl` package) — the universal source of truth, so this is
 * correct for EVERY TLD/ccTLD/private suffix without hand-maintained lists:
 *
 *   www.zambeel.lums.edu.pk → lums.edu.pk     foo.co.uk        → foo.co.uk
 *   www.liztek.ca           → liztek.ca       app.github.io    → app.github.io
 *                                             x.s3.amazonaws.com → x.s3.amazonaws.com
 *
 * Returns '' for anything that isn't a groupable hostname (empty, single-label,
 * an IP address, or a host:port) so callers can skip grouping on it.
 */
export function registrableDomain(host: string): string {
  const h = (host || '').toLowerCase().replace(/\.$/, '').trim();
  if (!h || !h.includes('.') || h.includes(':') || /^[\d.]+$/.test(h)) return '';
  try {
    return (psl.get(h) || '').toLowerCase();
  } catch {
    return '';
  }
}
