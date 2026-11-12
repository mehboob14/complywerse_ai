'use client';

// "Proposals": every library risk proposed to an owner, newest first, with what the person looking can do next (draft the
// score as the owner, review as the risk team, or look).

import { useQuery } from '@tanstack/react-query';
import { riskLibraryApi } from '../_lib/api';
import { STATUS_LABEL, type Proposal, type ProposalStatus } from '../_lib/model';

const STATUS_STYLE: Record<ProposalStatus, string> = {
  proposed: 'bg-[#e0ecff] text-[#1e40af]', drafted: 'bg-[#fef3c7] text-[#92400e]', returned: 'bg-[#ffedd5] text-[#9a3412]',
  declined: 'bg-[#eef1f4] text-[#586472]', accepted: 'bg-[#dcfce7] text-[#166534]',
};

const actionOf = (p: Proposal) => (p.you.may_draft ? 'Draft score' : p.you.may_challenge ? 'Review' : 'View');

export default function Proposals({ onOpen }: { onOpen: (id: number) => void }) {
  const list = useQuery({ queryKey: ['risk-library', 'proposals'], queryFn: riskLibraryApi.proposals });
  const rows = list.data || [];
  if (list.isLoading) return <p className="px-1 py-6 text-[14px] text-[#586472]">Loading…</p>;
  if (list.isError) return <p className="px-1 py-6 text-[14px] text-[#9b1c1c]">The proposals could not be loaded.</p>;

  return (
    <section className="overflow-hidden rounded-xl border border-[#d8dee4] bg-[#ffffff]">
      {!rows.length ? (
        <p className="px-4 py-10 text-center text-[14px] text-[#586472]">No library risk has been proposed yet. Propose one from the Library or Suggested tab.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#d8dee4] bg-[#f4f6f8]">
                <th scope="col" className="px-3 py-2.5 text-[12px] font-semibold text-[#586472]">Risk</th>
                <th scope="col" className="px-3 py-2.5 text-[12px] font-semibold text-[#586472]">Unit</th>
                <th scope="col" className="px-3 py-2.5 text-[12px] font-semibold text-[#586472]">Risk owner</th>
                <th scope="col" className="px-3 py-2.5 text-[12px] font-semibold text-[#586472]">Status</th>
                <th scope="col" className="px-3 py-2.5 text-right text-[12px] font-semibold text-[#586472]"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const next = actionOf(p);
                return (
                  <tr key={p.id} className="border-b border-[#eef1f4] align-top">
                    <td className="px-3 py-3">
                      <p className="text-[14px] font-medium leading-5 text-[#1f2933]">{p.risk?.title || p.title}</p>
                      <p className="text-[12px] leading-4 text-[#586472]">{p.objective_id} {p.objective_title} · proposed by {p.proposed_by_name || '—'}</p>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-[#1f2933]">{p.unit_name || '—'}</td>
                    <td className="px-3 py-3 text-[13px] text-[#1f2933]">{p.owner_name || '—'}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button type="button" onClick={() => onOpen(p.id)}
                        className={`inline-flex h-8 items-center whitespace-nowrap rounded-lg px-3 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] ${next === 'View' ? 'border border-[#c9d1d9] bg-[#ffffff] text-[#26323d] hover:bg-[#f4f6f8]' : 'bg-[#0f766e] text-[#ffffff] hover:bg-[#115e59]'}`}>
                        {next}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
