'use client';

// The requirements lenses by name: the registry (workspace/lensRegistry.tsx) loads one of these when its tab opens. Each is the one engine with its profile.
import type { LensProps } from '../workspace/lens';
import { ASVS, DCC, MASVS, MATURITY, OWASP } from './profiles';
import { RequirementsLens } from './RequirementsLens';

export const AsvsLens = (p: LensProps) => <RequirementsLens profile={ASVS} {...p} />;
export const OwaspLens = (p: LensProps) => <RequirementsLens profile={OWASP} {...p} />;
export const MobileLens = (p: LensProps) => <RequirementsLens profile={MASVS} {...p} />;
export const MaturityLens = (p: LensProps) => <RequirementsLens profile={MATURITY} {...p} />;
export const DccLens = (p: LensProps) => <RequirementsLens profile={DCC} {...p} />;
