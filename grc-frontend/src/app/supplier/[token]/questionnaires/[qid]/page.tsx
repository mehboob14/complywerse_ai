'use client';

// One questionnaire in the supplier portal: the same questionnaire a link of its own
// opens, reached through the contact's personal link.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import SupplierQuestionnaire from '@/components/vendor-risk/SupplierQuestionnaire';
import { LinkGone, Loading, PortalProblem, Shell, fetchHome, problemOf, type PortalFailure } from '../../../_shared';

export default function SupplierQuestionnairePage() {
  const { token, qid } = useParams<{ token: string; qid: string }>();
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<PortalFailure | null>(null);

  // The link is checked (and, on the first page loaded, the visit recorded) before the questionnaire opens.
  useEffect(() => {
    let live = true;
    fetchHome(token).then(() => { if (live) setReady(true); }).catch((e) => { if (live) setProblem(problemOf(e)); });
    return () => { live = false; };
  }, [token]);

  if (problem?.gone) return <LinkGone message={problem.message} />;
  if (problem) return <PortalProblem problem={problem} />;
  if (!ready) return <Shell><Loading /></Shell>;
  return (
    <SupplierQuestionnaire apiBase={`/vendor-risk/portal/${encodeURIComponent(token)}/questionnaires/${encodeURIComponent(qid)}`}
      backHref={`/supplier/${token}`} />
  );
}
