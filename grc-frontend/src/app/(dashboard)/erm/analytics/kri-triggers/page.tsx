'use client';

// Advanced Analytics > KRI triggers: one tool of the analytics page (the frame draws the head and the strip of tools; the tool is _tools/KriTriggersTool).
import { AnalyticsFrame } from '../_frame/AnalyticsFrame';
import { KriTriggersTool } from '../_tools/KriTriggersTool';

export default function Page() {
  return (
    <AnalyticsFrame tool="kri-triggers">
      <KriTriggersTool />
    </AnalyticsFrame>
  );
}
