'use client';

// Advanced Analytics > Dependencies: one tool of the analytics page (the frame draws the head and the strip of tools; the tool is _tools/DependenciesTool).
import { AnalyticsFrame } from '../_frame/AnalyticsFrame';
import { DependenciesTool } from '../_tools/DependenciesTool';

export default function Page() {
  return (
    <AnalyticsFrame tool="dependencies">
      <DependenciesTool />
    </AnalyticsFrame>
  );
}
