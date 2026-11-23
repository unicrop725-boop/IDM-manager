import { useMemo, useState } from "react";
import { BadgeCheck, ExternalLink, Globe, LayoutGrid, List, Search, SearchX, X, Grid3x3 } from "lucide-react";
import { api } from "../api";
import { hostOf, iconUrlOf, TRUSTED_SITES, type TrustedSite } from "../data/trustedSites";

interface Props {
  /** Defaults to the list in src/data/trustedSites.ts (a different list can be passed in for tests). */
  sites?: TrustedSite[];
  onNotice?: (text: string) => void;
}

const ALL = "All";

type ViewMode = "icons" | "cards" | "list";
const VIEW_KEY = "flowget_trusted_view";

const initialView = (): ViewMode => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "icons" || v === "cards" || v === "list") return v;
  } catch {
    /* storage may be unavailable */
  }
  return "cards";
};

/** The site's picture; a coloured letter when it cannot be loaded (offline, no favicon). */
function SiteIcon({ site, size }: { site: TrustedSite; size: number }) {
  const [failed, setFailed] = useState(false);
  const src = iconUrlOf(site);
  const box = { width: size, height: size };
  if (!src || failed) {
    return (
      <div
        style={{ ...box, fontSize: size * 0.42 }}
        className="flex flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500/30 to-purple-500/30 font-semibold text-[var(--text-primary)]"
      >
        {site.name.trim().charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <div style={box} className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/90 p-1.5">
      <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain" />
    </div>
  );
}

/** The "Trusted Sites" page: websites the user can rely on, with search and category filters. */
export default function TrustedSites({ sites = TRUSTED_SITES, onNotice }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [view, setViewState] = useState<ViewMode>(initialView);
  const setView = (v: ViewMode) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* the choice just is not remembered */
    }
  };

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sites) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sites]);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return sites
      .filter((s) => category === ALL || s.category === category)
      .filter((s) => {
        const hay = `${s.name} ${s.description} ${s.category} ${hostOf(s.url)} ${(s.tags ?? []).join(" ")}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sites, query, category]);

  const open = (s: TrustedSite) =>
    api.openUrl(s.url).catch((e) => onNotice?.(typeof e === "string" ? e : e?.message || "Could not open the website."));

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col select-none">
      {/* Header: title, search and filters */}
      <div className="flex-shrink-0 space-y-3 px-5 pb-3 pt-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Globe className="h-5 w-5 text-sky-400" strokeWidth={1.6} />
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Trusted Sites</h2>
              <p className="text-[11px] text-[var(--text-secondary)]">
                Websites we recommend for safe downloads. They open in your browser, and FlowGet takes over the download.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-0.5" role="group" aria-label="View">
            {([
              ["icons", Grid3x3, "Icons"],
              ["cards", LayoutGrid, "Cards"],
              ["list", List, "Wide list"],
            ] as const).map(([id, Icon, label]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                aria-pressed={view === id}
                title={label}
                className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] transition ${
                  view === id ? "bg-sky-500/20 text-sky-300" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">{label}</span>
              </button>
            ))}
          </div>
          <div className="relative w-72 max-w-[40%]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-disabled)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search trusted sites…"
              aria-label="Search trusted sites"
              className="h-9 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] pl-8 pr-8 text-[12px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-disabled)] focus:border-sky-500/60"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-disabled)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          </div>
        </div>

        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
            {[[ALL, sites.length] as [string, number], ...categories].map(([name, count]) => (
              <button
                key={name}
                onClick={() => setCategory(name)}
                aria-pressed={category === name}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition ${
                  category === name
                    ? "border-sky-500 bg-sky-500/15 text-sky-300"
                    : "border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                {name}
                <span className="text-[10px] opacity-70">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cards */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {sites.length === 0 ? (
          <Empty
            icon={<Globe className="h-9 w-9 opacity-60" strokeWidth={1.2} />}
            title="No websites added yet"
            text="The list of trusted websites will appear here."
          />
        ) : shown.length === 0 ? (
          <Empty
            icon={<SearchX className="h-9 w-9 opacity-60" strokeWidth={1.2} />}
            title="No site matches"
            text="Try another word, or choose a different category."
            action={
              <button
                onClick={() => {
                  setQuery("");
                  setCategory(ALL);
                }}
                className="rounded-lg bg-[var(--bg-hover)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:opacity-90"
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <>
            <div className="mb-2 text-[11px] text-[var(--text-disabled)]">
              {shown.length} of {sites.length} site{sites.length === 1 ? "" : "s"}
            </div>
            {view === "icons" && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
                {shown.map((s) => (
                  <button
                    key={s.url}
                    onClick={() => open(s)}
                    title={`${s.name} — ${s.description}\n${s.url}`}
                    className="group flex flex-col items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-4 text-center transition hover:border-sky-500/50 hover:bg-[var(--bg-hover)]"
                  >
                    <SiteIcon site={s} size={56} />
                    <span className="flex max-w-full items-center gap-1 text-[12px] font-medium text-[var(--text-primary)]">
                      <span className="truncate">{s.name}</span>
                      <BadgeCheck className="h-3 w-3 flex-shrink-0 text-emerald-400" aria-label="Trusted" />
                    </span>
                    <span className="max-w-full truncate rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-300">{s.category}</span>
                  </button>
                ))}
              </div>
            )}

            {view === "list" && (
              <div className="flex flex-col gap-2">
                {shown.map((s) => (
                  <button
                    key={s.url}
                    onClick={() => open(s)}
                    title={`Open ${s.url} in your browser`}
                    className="group flex w-full items-center gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3 text-left transition hover:border-sky-500/50 hover:bg-[var(--bg-hover)]"
                  >
                    <SiteIcon site={s} size={40} />
                    <div className="w-56 min-w-0 flex-shrink-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{s.name}</span>
                        <BadgeCheck className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" aria-label="Trusted" />
                      </div>
                      <div className="truncate text-[11px] text-[var(--text-secondary)]">{hostOf(s.url)}</div>
                    </div>
                    <p className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]" title={s.description}>
                      {s.description}
                    </p>
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">{s.category}</span>
                      {(s.tags ?? []).slice(0, 2).map((t) => (
                        <span key={t} className="hidden rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] lg:inline">
                          {t}
                        </span>
                      ))}
                    </div>
                    <ExternalLink className="h-4 w-4 flex-shrink-0 text-[var(--text-disabled)] transition group-hover:text-sky-400" />
                  </button>
                ))}
              </div>
            )}

            {view === "cards" && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {shown.map((s) => (
                <button
                  key={s.url}
                  onClick={() => open(s)}
                  title={`Open ${s.url} in your browser`}
                  className="group flex flex-col gap-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5 text-left transition hover:border-sky-500/50 hover:bg-[var(--bg-hover)]"
                >
                  <div className="flex items-center gap-3">
                    <SiteIcon site={s} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{s.name}</span>
                        <BadgeCheck className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" aria-label="Trusted" />
                      </div>
                      <div className="truncate text-[11px] text-[var(--text-secondary)]">{hostOf(s.url)}</div>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-disabled)] transition group-hover:text-sky-400" />
                  </div>
                  <p className="line-clamp-2 min-h-[2.4em] text-[12px] leading-snug text-[var(--text-secondary)]">{s.description}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">{s.category}</span>
                    {(s.tags ?? []).map((t) => (
                      <span key={t} className="rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                        {t}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center">
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-[var(--bg-panel)]/70 px-8 py-6 text-center text-[var(--text-secondary)]">
        {icon}
        <div className="text-[13px] font-medium text-[var(--text-primary)]">{title}</div>
        <p className="text-[12px]">{text}</p>
        {action}
      </div>
    </div>
  );
}
