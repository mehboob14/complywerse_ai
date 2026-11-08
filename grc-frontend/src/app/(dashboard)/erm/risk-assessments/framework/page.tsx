import { redirect } from 'next/navigation';

// The old Framework page (a create form, Saved assessments, Assigned To Me) is the home filtered to the framework assessments: the form is the panel "New assessment > From a framework",
// "Saved" is the list, and "Assigned To Me" is the quick view of that name (?tab=assigned).
export default function FrameworkAssessmentsForward({ searchParams }: { searchParams?: { tab?: string } }) {
  redirect(searchParams?.tab === 'assigned' ? '/erm/risk-assessments?kind=framework&quick=mine' : '/erm/risk-assessments?kind=framework');
}
