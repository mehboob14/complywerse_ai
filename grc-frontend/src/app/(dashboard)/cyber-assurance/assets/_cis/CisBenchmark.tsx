'use client';

/**
 * CIS Benchmark — the two CIS pages behind the IT Asset Inventory "CIS Benchmark"
 * tab. The Dashboard / Benchmark Hierarchy toggle lives on the main tab row in
 * assets/page.tsx (right-aligned, same row), so this is a controlled switch on
 * `view`. Each view is a self-contained panel (own data fetching + layout).
 */

import CisDashboard from './CisDashboard';
import CisHierarchy from './CisHierarchy';

type CisView = 'dashboard' | 'hierarchy';

export default function CisBenchmark({ view = 'dashboard' }: { view?: CisView }) {
  return view === 'dashboard' ? <CisDashboard /> : <CisHierarchy />;
}
