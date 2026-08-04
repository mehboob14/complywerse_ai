'use client';

/**
 * FrameworkJourney — the "Journey" tab. Renders the shared identity band once,
 * with a Map / List toggle, then the interactive graph (default) or the vertical
 * trajectory list. Both draw from the same _data/frameworkFlows definition.
 */

import { useState } from 'react';
import { List, Network } from 'lucide-react';
import type { FrameworkFlow } from '../_data/frameworkFlows';
import JourneyMeta from './JourneyMeta';
import FrameworkJourneyFlow from './FrameworkJourneyFlow';
import FrameworkJourneyMap from './FrameworkJourneyMap';
import type { StageOwner } from './_StageOwnerPicker';

interface Props {
  flow: FrameworkFlow;
  liveControls?: number;
  /** 0–1 completion of the live journey, used to mark stage status. */
  progressRatio?: number;
  /** Journey id + saved per-stage owner assignments — enable owner editing. */
  journeyId?: number;
  stageOwners?: Record<string, StageOwner>;
  /** Framework catalog id + name — enable "Create in Governance" from stages. */
  frameworkId?: number | null;
  frameworkName?: string;
}

type View = 'map' | 'list';

export default function FrameworkJourney({ flow, liveControls, progressRatio = 0, journeyId, stageOwners, frameworkId, frameworkName }: Props) {
  const [view, setView] = useState<View>('list');

  return (
    <div className="space-y-5">
      <JourneyMeta flow={flow} liveControls={liveControls} right={<ViewToggle view={view} setView={setView} />} />
      {view === 'map' ? (
        <FrameworkJourneyMap flow={flow} liveControls={liveControls} progressRatio={progressRatio} />
      ) : (
        <FrameworkJourneyFlow flow={flow} liveControls={liveControls} showMeta={false} progressRatio={progressRatio} journeyId={journeyId} stageOwners={stageOwners} frameworkId={frameworkId} frameworkName={frameworkName} />
      )}
    </div>
  );
}

function ViewToggle({ view, setView }: { view: View; setView: (v: View) => void }) {
  const base = 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors';
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      <button
        onClick={() => setView('map')}
        className={`${base} ${view === 'map' ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
      >
        <Network className="h-3.5 w-3.5" strokeWidth={1.9} /> Map
      </button>
      <button
        onClick={() => setView('list')}
        className={`${base} ${view === 'list' ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
      >
        <List className="h-3.5 w-3.5" strokeWidth={1.9} /> List
      </button>
    </div>
  );
}
