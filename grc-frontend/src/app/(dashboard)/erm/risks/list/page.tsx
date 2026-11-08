// The old register page: its address forwards to the Risk Register, keeping every parameter it ever took (?new=1, ?upload=1, ?edit=<risk id>, ?register_type=<name>).
import { redirect } from 'next/navigation';

export default function RiskRegisterListRedirect({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([key, value]) => (Array.isArray(value) ? value : [value]).forEach((v) => { if (v !== undefined) query.append(key, v); }));
  const qs = query.toString();
  redirect(`/erm/risks${qs ? `?${qs}` : ''}`);
}
