'use client';

// Risk Library: the risks a standard lists under its control objectives. Pick a framework, narrow by family, control objective or
// words, and move any risk into the risk register through the "Add to register" pop-up.

import { Fragment, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, Check, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/ui/ToastProvider';
import { PageLoader } from '@/components/ui';
import AddToRegisterDialog from './_components/AddToRegisterDialog';
import { riskLibraryApi, type AddedRisk } from './_lib/api';
import { PAGE_SIZE, addressOf, apiParams, filtersFrom, rangeText, type Filters, type LibraryRisk, type View } from './_lib/model';

const SELECT = 'mt-1 h-9 w-full rounded-lg border border-[#c9d1d9] bg-[#ffffff] px-2.5 text-[13px] text-[#1f2933] focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/30';
const LABEL = 'block text-[12px] font-medium text-[#586472]';
const VIEWS: { value: View; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'open', label: 'Not in register' }, { value: 'added', label: 'In register' }];

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-[#d8dee4] bg-[#ffffff] px-4 py-3">
      <p className="text-[12px] font-medium text-[#586472]">{label}</p>
      <p className="mt-0.5 text-[22px] font-semibold leading-7 text-[#1f2933]">{value}</p>
    </div>
  );
}

function Library() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasAnyPermission } = usePermissions();
  const mayAdd = hasAnyPermission(['erm:risks:create', 'erm:risks:edit']);

  const filters = filtersFrom((k) => params.get(k));
  const [typed, setTyped] = useState(filters.q);                       // the words box answers at once; the list follows a moment later
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<LibraryRisk | null>(null);

  const change = (next: Partial<Filters>) => {
    const merged = { ...filters, ...next, page: next.page ?? 1 };
    router.replace(`${pathname}${addressOf(merged)}`, { scroll: false });
  };
  useEffect(() => {
    if (typed.trim() === filters.q) return;
    const t = setTimeout(() => change({ q: typed }), 300);
    return () => clearTimeout(t);
  }, [typed]);                                                          // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTyped(filters.q); }, [filters.q]);

  const library = useQuery({
    queryKey: ['risk-library', filters],
    queryFn: () => riskLibraryApi.list(apiParams(filters)),
    placeholderData: keepPreviousData,
  });
  const data = library.data;
  const framework = data?.framework;
  const families = data?.facets.families || [];
  const objectives = (data?.facets.objectives || []).filter((o) => !filters.family || o.family_id === filters.family);
  const pages = Math.max(1, Math.ceil((data?.total || 0) / PAGE_SIZE));

  const added = (a: AddedRisk) => {
    setAdding(null);
    queryClient.invalidateQueries({ queryKey: ['risk-library'] });
    toast({ type: 'success', title: 'Added to the risk register', message: `Risk #${a.risk.id}: ${a.risk.title}` });
  };

  if (library.isLoading) return <PageLoader />;
  if (library.isError || !data) {
    return <p className="px-1 py-6 text-[14px] text-[#9b1c1c]">The risk library could not be loaded. Try again in a moment.</p>;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#e6f6f3] text-[#0f766e]">
            <BookMarked aria-hidden className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="!text-[22px] font-semibold leading-7 text-[#1f2933]">Risk Library</h1>
            <p className="text-[13px] leading-5 text-[#586472]">Risks a standard lists, ready to move into your register.</p>
          </div>
        </div>
        <Link href="/erm/risks" className="inline-flex h-9 items-center rounded-lg border border-[#c9d1d9] bg-[#ffffff] px-4 text-[14px] font-medium text-[#26323d] hover:bg-[#f4f6f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
          Risk register
        </Link>
      </header>

      {!framework ? (
        <p className="rounded-xl border border-[#d8dee4] bg-[#ffffff] px-4 py-8 text-center text-[14px] text-[#586472]">No risk library is installed yet.</p>
      ) : (
        <>
          <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Risks in the library" value={framework.risks} />
            <Stat label="Control objectives" value={framework.objectives} />
            <Stat label="Families" value={framework.families} />
            <Stat label="In your register" value={data.in_register_total} />
          </section>

          <section aria-label="Filters" className="grid gap-3 rounded-xl border border-[#d8dee4] bg-[#ffffff] p-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label htmlFor="rl-framework" className={LABEL}>Framework</label>
              <select id="rl-framework" className={SELECT} value={framework.key} onChange={(e) => change({ framework: e.target.value, family: '', objective: '' })}>
                {data.frameworks.map((f) => <option key={f.key} value={f.key}>{f.name}{f.version ? ` v${f.version}` : ''}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rl-family" className={LABEL}>Family</label>
              <select id="rl-family" className={SELECT} value={filters.family} onChange={(e) => change({ family: e.target.value, objective: '' })}>
                <option value="">All families</option>
                {families.map((f) => <option key={f.id} value={f.id}>{f.id} {f.name} ({f.count})</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rl-objective" className={LABEL}>Control objective</label>
              <select id="rl-objective" className={SELECT} value={filters.objective} onChange={(e) => change({ objective: e.target.value })}>
                <option value="">All objectives</option>
                {objectives.map((o) => <option key={o.id} value={o.id}>{o.id} {o.title} ({o.count})</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rl-search" className={LABEL}>Search</label>
              <input id="rl-search" type="search" className={SELECT} value={typed} placeholder="Risk, objective or control" onChange={(e) => setTyped(e.target.value)} />
            </div>
            <div>
              <span id="rl-view" className={LABEL}>Show</span>
              <div role="group" aria-labelledby="rl-view" className="mt-1 flex h-9 overflow-hidden rounded-lg border border-[#c9d1d9]">
                {VIEWS.map((v) => (
                  <button key={v.value} type="button" aria-pressed={filters.view === v.value} onClick={() => change({ view: v.value })}
                    className={`flex-1 px-2 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f766e] ${filters.view === v.value ? 'bg-[#0f766e] text-[#ffffff]' : 'bg-[#ffffff] text-[#26323d] hover:bg-[#f4f6f8]'}`}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#d8dee4] bg-[#ffffff]">
            {data.items.length === 0 ? (
              <p className="px-4 py-10 text-center text-[14px] text-[#586472]">No risks match these filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#d8dee4] bg-[#f4f6f8]">
                      <th scope="col" className="w-8 px-2 py-2.5"><span className="sr-only">Details</span></th>
                      <th scope="col" className="px-3 py-2.5 text-[12px] font-semibold text-[#586472]">Risk</th>
                      <th scope="col" className="px-3 py-2.5 text-[12px] font-semibold text-[#586472]">Control objective</th>
                      <th scope="col" className="px-3 py-2.5 text-[12px] font-semibold text-[#586472]">Controls</th>
                      <th scope="col" className="px-3 py-2.5 text-right text-[12px] font-semibold text-[#586472]">Register</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((r) => {
                      const expanded = open === r.id;
                      return (
                        <Fragment key={r.id}>
                          <tr className="border-b border-[#eef1f4] align-top">
                            <td className="px-2 py-3">
                              <button type="button" aria-expanded={expanded} aria-label={expanded ? 'Hide details' : 'Show details'} onClick={() => setOpen(expanded ? null : r.id)}
                                className="flex h-6 w-6 items-center justify-center rounded text-[#586472] hover:bg-[#e4e9ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
                                {expanded ? <ChevronDown aria-hidden className="h-4 w-4" /> : <ChevronRight aria-hidden className="h-4 w-4" />}
                              </button>
                            </td>
                            <td className="px-3 py-3">
                              <p className="text-[14px] font-medium leading-5 text-[#1f2933]">{r.title}</p>
                            </td>
                            <td className="px-3 py-3">
                              <p className="text-[13px] leading-5 text-[#1f2933]"><span className="font-medium">{r.objective_id}</span> {r.objective_title}</p>
                              <p className="text-[12px] leading-4 text-[#586472]">{r.family_id} {r.family_name}</p>
                            </td>
                            <td className="px-3 py-3">
                              <span title={r.controls.map((c) => c.control_id).join(', ')} className="inline-flex h-6 items-center rounded-full bg-[#eef1f4] px-2.5 text-[12px] font-medium text-[#26323d]">
                                {r.controls.length} {r.controls.length === 1 ? 'control' : 'controls'}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                {r.in_register && (
                                  <Link href={`/erm/risks/${r.in_register.risk_id}`} className="inline-flex h-7 items-center gap-1 rounded-full bg-[#dcfce7] px-2.5 text-[12px] font-medium text-[#166534] hover:bg-[#bbf7d0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
                                    <Check aria-hidden className="h-3.5 w-3.5" /> In register
                                  </Link>
                                )}
                                {mayAdd && (
                                  <button type="button" onClick={() => setAdding(r)}
                                    className={`inline-flex h-8 items-center gap-1 rounded-lg px-3 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] ${r.in_register ? 'border border-[#c9d1d9] bg-[#ffffff] text-[#26323d] hover:bg-[#f4f6f8]' : 'bg-[#0f766e] text-[#ffffff] hover:bg-[#115e59]'}`}>
                                    <Plus aria-hidden className="h-3.5 w-3.5" /> {r.in_register ? 'Add again' : 'Add to register'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="border-b border-[#eef1f4] bg-[#f9fafb]">
                              <td />
                              <td colSpan={4} className="px-3 py-3">
                                <p className="text-[13px] leading-5 text-[#26323d]">{r.objective}</p>
                                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Controls under this objective">
                                  {r.controls.map((c) => (
                                    <li key={c.control_id} className="rounded-md bg-[#ffffff] px-2 py-1 text-[12px] leading-4 text-[#26323d] ring-1 ring-[#d8dee4]">
                                      <span className="font-medium">{c.control_id}</span> {c.title}{c.priority ? ` · ${c.priority}` : ''}
                                    </li>
                                  ))}
                                </ul>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <footer className="flex items-center justify-between border-t border-[#d8dee4] px-3 py-2">
              <p className="text-[13px] text-[#586472]" aria-live="polite">{rangeText(filters.page, data.total)}</p>
              <div className="flex items-center gap-2">
                <button type="button" disabled={filters.page <= 1} onClick={() => change({ page: filters.page - 1 })}
                  className="h-8 rounded-lg border border-[#c9d1d9] bg-[#ffffff] px-3 text-[13px] font-medium text-[#26323d] hover:bg-[#f4f6f8] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">Previous</button>
                <span className="text-[13px] text-[#586472]">Page {filters.page} of {pages}</span>
                <button type="button" disabled={filters.page >= pages} onClick={() => change({ page: filters.page + 1 })}
                  className="h-8 rounded-lg border border-[#c9d1d9] bg-[#ffffff] px-3 text-[13px] font-medium text-[#26323d] hover:bg-[#f4f6f8] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">Next</button>
              </div>
            </footer>
          </section>
        </>
      )}

      <AddToRegisterDialog risk={adding} onClose={() => setAdding(null)} onAdded={added} />
    </div>
  );
}

export default function RiskLibraryPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Library />
    </Suspense>
  );
}
