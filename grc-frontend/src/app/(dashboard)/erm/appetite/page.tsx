'use client';

// Risk Management > Risk Appetite: breaches first, the statement second (_monitoring/AppetiteBoard). Every address that opened this page still does.
import { routeFor } from '@/lib/navRegistry';
import AppetiteBoard from '../_monitoring/AppetiteBoard';

export default function AppetitePage() {
  return <AppetiteBoard label={routeFor('/erm/appetite')?.label ?? 'Risk Appetite'} />;
}
