'use client';

// Advanced Analytics > Scenario: one tool of the analytics page (the frame draws the head and the strip of tools; the tool is _tools/ScenarioTool).
import { AnalyticsFrame } from '../_frame/AnalyticsFrame';
import { ScenarioTool } from '../_tools/ScenarioTool';

export default function Page() {
  return (
    <AnalyticsFrame tool="scenario">
      <ScenarioTool />
    </AnalyticsFrame>
  );
}
