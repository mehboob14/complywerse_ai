'use client';

// The three NCA registers by name: the registry loads one of these when its tab opens. Each is the register lens with its kind.
import type { LensProps } from '../workspace/lens';
import RegisterLens from './RegisterLens';

export const VulnLens = (p: LensProps) => <RegisterLens kind="vuln" {...p} />;
export const AuditLens = (p: LensProps) => <RegisterLens kind="audit" {...p} />;
export const RiskLens = (p: LensProps) => <RegisterLens kind="risk" {...p} />;
