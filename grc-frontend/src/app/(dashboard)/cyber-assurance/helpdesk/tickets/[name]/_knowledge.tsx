"use client";

/**
 * Knowledge (Batch 4 linkage C) — attach a resolution / suggested KB article to
 * the ticket. Shows the attached articles (link to /helpdesk/kb, with remove),
 * the server's subject-ranked suggestions as one-click attaches, and a search
 * box over all articles. Self-contained; drives the kb-link endpoints only.
 *   GET    /helpdesk/tickets/{name}/kb-links
 *   GET    /helpdesk/tickets/{name}/kb-suggestions
 *   GET    /helpdesk/articles                              (search source)
 *   POST   /helpdesk/tickets/{name}/kb-links      {article_id}
 *   DELETE /helpdesk/tickets/{name}/kb-links/{article_id}
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Plus, Sparkles, X } from "lucide-react";
import { useHd } from "../../_ui";
import { hdCall } from "../../_admin";
import { ComboBoxInput } from "@/cyber-assurance/components/ui/ComboBoxInput";

type Article = { name: string; title?: string | null; category?: string | null; status?: string | null; url?: string | null };

function ArticleLine({ a, onAttach, onRemove, busy }: {
  a: Article; onAttach?: () => void; onRemove?: () => void; busy?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[12px]">
      <span className="min-w-0 flex-1">
        <Link href={a.url || "/helpdesk/kb"} className="block truncate font-medium text-[var(--color-base)] hover:underline">
          {a.title || `Article #${a.name}`}
        </Link>
        {a.category && <span className="text-[10.5px] text-slate-400">{a.category}</span>}
      </span>
      {onAttach && (
        <button onClick={onAttach} disabled={busy} title="Attach article"
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-[var(--color-base)] disabled:opacity-50">
          <Plus size={13} />
        </button>
      )}
      {onRemove && (
        <button onClick={onRemove} disabled={busy} title="Detach article"
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50">
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export function Knowledge({ name, kbLinks, onChanged }: {
  name: string;
  kbLinks?: Article[] | null;
  onChanged?: () => void;
}) {
  const id = encodeURIComponent(name);
  const links = kbLinks || [];
  const suggestions = useHd<{ suggestions: Article[] }>(`/helpdesk/tickets/${id}/kb-suggestions`);
  const all = useHd<{ articles: Article[] }>("/helpdesk/articles");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const linkedIds = useMemo(() => new Set(links.map((a) => String(a.name))), [links]);

  const attach = async (articleName: string) => {
    const article_id = Number(articleName);
    if (!article_id) return;
    setBusy(true); setErr(null);
    const r = await hdCall("post", `/helpdesk/tickets/${id}/kb-links`, { article_id });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not attach that article."); return; }
    onChanged?.();
  };
  const detach = async (articleName: string) => {
    setBusy(true); setErr(null);
    const r = await hdCall("delete", `/helpdesk/tickets/${id}/kb-links/${encodeURIComponent(articleName)}`);
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not detach that article."); return; }
    onChanged?.();
  };

  const suggs = (suggestions.data?.suggestions || []).filter((a) => !linkedIds.has(String(a.name)));
  // Every attachable (unlinked) article, for the manual searchable dropdown — so
  // you can pick one even if you don't remember the exact title.
  const options = useMemo(
    () => (all.data?.articles || [])
      .filter((a) => !linkedIds.has(String(a.name)))
      .map((a) => ({ value: String(a.name), label: a.title || `Article #${a.name}`, hint: a.category || undefined })),
    [all.data, linkedIds],
  );

  return (
    <div>
      <h3 className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <BookOpen size={13} /> Knowledge
      </h3>

      {links.length > 0 ? (
        <div className="mb-2 space-y-1">
          {links.map((a) => <ArticleLine key={a.name} a={a} onRemove={() => detach(a.name)} busy={busy} />)}
        </div>
      ) : (
        <p className="mb-2 text-[11.5px] text-slate-300">No articles attached.</p>
      )}

      {suggs.length > 0 && (
        <div className="mb-2 space-y-1">
          <div className="inline-flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wide text-slate-400">
            <Sparkles size={11} /> Suggested
          </div>
          {suggs.map((a) => <ArticleLine key={a.name} a={a} onAttach={() => attach(a.name)} busy={busy} />)}
        </div>
      )}

      {/* Manual picker — searchable dropdown of ALL attachable articles, so one
          can be chosen even without remembering the exact title. */}
      <ComboBoxInput
        ariaLabel="Attach knowledge article"
        value=""
        onChange={(v) => { if (v) attach(v); }}
        options={options}
        placeholder={options.length ? "Search or pick an article…" : "No articles available"}
        allowCustom={false}
        disabled={busy || options.length === 0}
      />
      {err && <p className="mt-1 text-[11px] text-rose-600">{err}</p>}
    </div>
  );
}
