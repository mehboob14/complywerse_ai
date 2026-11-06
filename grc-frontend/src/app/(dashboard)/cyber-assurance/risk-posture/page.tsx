'use client';

export const dynamic = 'force-dynamic';

// Thin wrapper — the module lives in _redesign/RiskPostureWorkspace (handoff redesign).
import RiskPostureWorkspace from './_redesign/RiskPostureWorkspace';

export default function RiskPosturePage() {
  return <RiskPostureWorkspace />;
}
