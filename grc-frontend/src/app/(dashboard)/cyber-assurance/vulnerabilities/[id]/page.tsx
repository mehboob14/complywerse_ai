'use client';

/**
 * Vulnerability finding detail — redesigned to the handoff mock. The shell +
 * Analysis + Exploit-Test (driven by the real backend exploitability engine) +
 * Remediation / History / Notes live in _redesign/FindingDetail.
 *
 * The prior 4500-line detail also carried exceptions / workflow transitions /
 * department assignment / ITSM push / control links / dependencies / threat-intel
 * — none of which are in the mock. That code is preserved in git history; re-add
 * any of it as an extra tab or rail card on request.
 */

import { useParams } from 'next/navigation';
import FindingDetail from './_redesign/FindingDetail';

export default function VulnerabilityDetailPage() {
  const params = useParams();
  const vulnId = Number(params?.id);
  if (!Number.isFinite(vulnId)) return null;
  return <FindingDetail vulnId={vulnId} />;
}
