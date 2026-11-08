'use client';

export const dynamic = 'force-dynamic';

// Assessments > Types: every kind of assessment, with Start, Upload or Open for each. Everything is in _types/TypesPage.tsx; the page is its address.
import { TypesPage } from '../_types/TypesPage';

export default function AssessmentTypesPage() {
  return <TypesPage />;
}
