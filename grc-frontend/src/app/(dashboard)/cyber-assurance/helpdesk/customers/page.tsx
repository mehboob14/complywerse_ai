"use client";

import { useMemo, useState } from "react";
import { Building2, Search, Globe } from "lucide-react";
import { PageHeader, RefreshBtn, Table, Empty, ErrorBanner, Loading, useHd } from "../_ui";

export default function CustomersPage() {
  const { data, loading, error, reload } = useHd<any>("/helpdesk/customers");
  const [q, setQ] = useState("");
  const customers: any[] = Array.isArray(data?.customers) ? data.customers : [];
  const rows = useMemo(() => {
    const s = q.toLowerCase();
    return customers.filter((c) => !s || [c.customer_name, c.name, c.domain].some((v) => (v || "").toLowerCase().includes(s)));
  }, [customers, q]);

  return (
    <div className="space-y-5 p-6">
      <PageHeader icon={Building2} title="Customers" subtitle={`${customers.length} customer${customers.length === 1 ? "" : "s"}`}
        actions={<>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers…"
              className="w-60 rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-base)]" />
          </div>
          <RefreshBtn onClick={reload} loading={loading} />
        </>} />
      {error && <ErrorBanner msg={error} />}
      {loading ? <Loading what="customers" /> : rows.length === 0 ? <Empty icon={Building2} title="No customers found" hint={q ? "Try a different search." : undefined} /> : (
        <Table head={["Customer", "Domain", "Contacts"]}>
          {rows.map((c) => (
            <tr key={c.name} className="hover:bg-slate-50">
              <td className="px-4 py-2.5"><div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Building2 size={16} /></span>
                <span className="font-medium text-[var(--color-text)]">{c.customer_name || c.name}</span></div></td>
              <td className="px-4 py-2.5">{c.domain
                ? <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700"><Globe size={12} />{c.domain}</span>
                : <span className="text-slate-300">—</span>}</td>
              <td className="px-4 py-2.5 text-slate-600">{c.contacts_count ?? 0}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
