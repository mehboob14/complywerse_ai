'use client';

export const dynamic = 'force-dynamic';

// Assessments > All assessments: every assessment of the organization on the facet explorer. Everything is in _register/AssessmentsRegister.tsx; the page is its address.
import { AssessmentsRegister } from '../_register/AssessmentsRegister';

export default function AssessmentsRegisterPage() {
  return <AssessmentsRegister />;
}
