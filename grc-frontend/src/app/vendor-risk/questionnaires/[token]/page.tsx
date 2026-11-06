'use client';

// A questionnaire's own link, as sent before personal links: still honoured.
// The supplier portal opens the same questionnaire under /supplier/<link>.

import { useParams } from 'next/navigation';
import SupplierQuestionnaire from '@/components/vendor-risk/SupplierQuestionnaire';

export default function ExternalQuestionnairePage() {
  const params = useParams();
  const token = String(params.token || '');
  return <SupplierQuestionnaire apiBase={`/vendor-risk/questionnaires/external/${encodeURIComponent(token)}`} />;
}
