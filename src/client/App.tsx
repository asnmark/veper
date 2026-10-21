import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, ChevronDown, CircleHelp, Clock3, Globe2, Menu, RadioTower, RefreshCw, Search, Signal, Zap } from "lucide-react";
import { SourceRail, type DeskFilter } from "./components/SourceRail.js";
import { StoryDossier } from "./components/StoryDossier.js";
import { StoryList } from "./components/StoryList.js";
import { useDesk } from "./hooks/useDesk.js";
import { categoryLabels, formatClock, formatDate, formatDateTime, isDevelopingStory, latestStoryActivity, significantText } from "./format.js";
import type { StoryCategory } from "../shared/types.js";

const categories = Object.keys(categoryLabels) as StoryCategory[];

export function App() {
  const { desk, loading, loadError, refreshing, notice, refresh, saveStory } = useDesk();
  const [filter, setFilter] = useState<DeskFilter>("all");
  const [category, setCategory] = useState<StoryCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [localClock, setLocalClock] = useState(() => new Date().toISOString());
  const searchRef = useRef<HTMLInputElement>(null);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);

  const closeRail = useCallback(() => {
    setRailOpen(false);
    if (window.matchMedia("(max-width: 760px)").matches) {
      window.requestAnimationFrame(() => mobileMenuRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setLocalClock(new Date().toISOString()), 30_000);
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "/" && !["INPUT", "TEXTAREA"].includes((event.target as HTMLElement | null)?.tagName ?? "")) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "Escape") {
        closeRail();
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", shortcut);
    };
  }, [closeRail]);

  const filteredStories = useMemo(() => {
    if (!desk) return [];
    const query = significantText(search.trim());
    const matchingStories = desk.stories.filter((story) => {
      if (filter === "developing" && !isDevelopingStory(story, desk.generatedAt)) return false;
      if (filter === "discrepancies" && !story.analysis?.comparisons.some((entry) => entry.kind !== "agreement")) return false;
      if (filter === "multi-source" && new Set(story.articles.map((article) => article.sourceId)).size < 2) return false;
      if (filter === "saved" && !story.saved) return false;
      if (filter === "si" && !story.articles.some((article) => article.region === "si")) return false;
      if (filter === "world" && !story.articles.some((article) => article.region === "world")) return false;
      if (category !== "all" && story.category !== category) return false;
      if (!query) return true;
      const searchable = significantText([
        story.title,
        ...story.articles.flatMap((article) => [article.title, article.summary, article.sourceName]),
        ...(story.analysis?.briefing.map((point) => point.text) ?? []),
      ].join(" "));
      return searchable.includes(query);
    });
    return filter === "developing"
      ? matchingStories.sort((left, right) => latestStoryActivity(right) - latestStoryActivity(left))
      : matchingStories;
  }, [category, desk, filter, search]);

  useEffect(() => {
    if (!filteredStories.some((story) => story.id === selectedId)) {
      setSelectedId(filteredStories[0]?.id ?? null);
    }
  }, [filteredStories, selectedId]);

  const selectedStory = filteredStories.find((story) => story.id === selectedId) ?? null;
  const activeSources = desk?.sources.filter((source) => source.state === "online").length ?? 0;
  const availableSources = desk?.sources.length ?? 0;
  const checkedSources = desk?.sources.some((source) => source.lastCheckedAt !== null) ?? false;
  const dataLive = activeSources > 0;
  const sourceStatus = availableSources === 0
    ? "BREZ NASTAVLJENIH VIROV"
    : activeSources > 0
      ? `${activeSources}/${availableSources} VIROV DOSEGLJIVIH`
      : checkedSources
        ? `0/${availableSources} VIROV DOSEGLJIVIH`
        : "VIRI ČAKAJO NA PREVERJANJE";
  const aiStatus = !desk?.ai.model
    ? "VIRNI PREGLED"
    : `GEMINI · ${{
      disabled: "IZKLOPLJEN",
      idle: "ČAKA NA NOVE OBJAVE",
      queued: "ČAKA V VRSTI",
      processing: "PRIMERJAVA POTEKA",
      ready: "AI PREGLED ZAKLJUČEN",
      error: "NI DOSEGLJIV",
    }[desk.ai.state]}`;

  return <div className="veper-app">
    <header className="topbar">
      <div className="brand-lockup">
        <span className="brand-symbol" aria-hidden="true"><span /><span /><span /></span>
        <span className="brand-word">VEPER</span>
        <span className="brand-divider" aria-hidden="true" />
        <span className="brand-descriptor">INTELIGENCA ZA REDAKCIJO</span>
      </div>
      <button ref={mobileMenuRef} type="button" className="mobile-menu" aria-label={railOpen ? "Zapri filtre" : "Odpri filtre"}
        aria-controls="source-rail" aria-expanded={railOpen} onClick={() => railOpen ? closeRail() : setRailOpen(true)}>
        <Menu size={19} aria-hidden="true" />
      </button>
      <div className="topbar-meta">
        <div className={`live-indicator ${dataLive ? "is-live" : "is-waiting"}`}>
          <span className="live-dot" aria-hidden="true" />
          <span>{sourceStatus}</span>
        </div>
        <span className="topbar-date"><Clock3 size={13} aria-hidden="true" /> {formatClock(localClock)} LJUBLJANA</span>
        <button type="button" className="refresh-button" aria-label="Osveži vire" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? "is-spinning" : ""} aria-hidden="true" />
          <span>{refreshing ? "Osvežujem" : "Osveži vire"}</span>
        </button>
      </div>
    </header>

    <div className="app-body">
      <SourceRail filter={filter} onFilter={setFilter} sources={desk?.sources ?? []}
        stories={desk?.stories ?? []} now={desk?.generatedAt ?? localClock} open={railOpen} onClose={closeRail} />

      <main className="work-area">
        <section className="signal-column" aria-labelledby="desk-heading">
          <div className="desk-heading-row">
            <div>
              <p className="eyebrow"><Signal size={12} aria-hidden="true" /> UREDNIŠKI RADAR <span className="eyebrow-separator">/</span> {desk ? formatDate(desk.generatedAt).toLocaleUpperCase("sl-SI") : "ČAKA NA PODATKE"}</p>
              <h1 id="desk-heading">Uredniški pregled</h1>
              <p className="desk-subtitle">Zgodbe skozi več virov. Razlike, ki potrebujejo vaš naslednji klic.</p>
            </div>
            <div className="timezone-note"><Globe2 size={12} aria-hidden="true" /> LJUBLJANA</div>
          </div>

          <div className="metric-strip" aria-label="Dejanski kazalniki virov">
            <div className="metric"><strong>{desk?.stats.activeStories ?? "—"}</strong><span>AKTIVNE ZGODBE</span></div>
            <div className="metric"><strong>{desk?.stats.freshArticles ?? "—"}</strong><span>ZAJETE · 30 MIN</span></div>
            <div className="metric"><strong>{desk?.stats.crossSourceStories ?? "—"}</strong><span>VEČ VIROV</span></div>
            <div className="metric metric-alert"><strong>{desk?.stats.storiesWithDiscrepancies ?? "—"}</strong><span>ZA PREVERITI</span></div>
          </div>

          {desk?.ai.state === "disabled" && <div className="service-banner" role="status">
            <CircleHelp size={15} aria-hidden="true" /><span>{desk.ai.message}</span>
          </div>}
          {desk?.ai.state === "queued" && <div className="service-banner" role="status">
            <CircleHelp size={15} aria-hidden="true" /><span>{desk.ai.message}</span>
          </div>}
          {desk?.ai.state === "error" && <div className="service-banner is-warning" role="status">
            <AlertTriangle size={15} aria-hidden="true" /><span>{desk.ai.message}</span>
          </div>}
          {loadError && <div className="service-banner is-warning" role="alert">
            <AlertTriangle size={15} aria-hidden="true" /><span>{loadError}</span>
          </div>}

          <div className="story-toolbar">
            <label className="search-field">
              <Search size={15} aria-hidden="true" />
              <input ref={searchRef} type="search" aria-label="Išči zgodbe" placeholder="Išči osebe, kraje, teme …" value={search} onChange={(event) => setSearch(event.target.value)} />
              <kbd>⌘ K</kbd>
            </label>
            <label className="category-select-wrap">
              <span className="visually-hidden">Uredniška rubrika</span>
              <select aria-label="Uredniška rubrika" value={category} onChange={(event) => setCategory(event.target.value as StoryCategory | "all")}>
                <option value="all">Vse rubrike</option>
                {categories.map((entry) => <option value={entry} key={entry}>{categoryLabels[entry]}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </label>
          </div>

          <div className="story-stream-heading">
            <div><Zap size={14} aria-hidden="true" /><h2>Žive zgodbe</h2></div>
            <span>{loading ? "NALAGAM" : `${filteredStories.length} ${filteredStories.length === 1 ? "ZGODBA" : "ZGODBE"}`}</span>
          </div>

          {loading ? <div className="loading-state" role="status"><span className="loading-pulse" />Povezujem javne vire …</div> : desk?.stories.length === 0 ? <div className="first-data-state">
            <span className="first-data-icon"><RadioTower size={21} aria-hidden="true" /></span>
            <p className="eyebrow">ČAKAMO NA OBJAVE</p>
            <h2>Za zdaj brez novih zgodb</h2>
            <p>Ko preverjeni javni viri objavijo novo novico, se bo tukaj odprl dosje z izvirno povezavo.</p>
            <button type="button" className="text-action" onClick={() => void refresh()}>Preveri vire <ArrowRight size={14} aria-hidden="true" /></button>
          </div> : <StoryList stories={filteredStories} selectedId={selectedId} now={desk?.generatedAt ?? localClock} onSelect={setSelectedId} />}

          <div className="stream-footnote"><Activity size={12} aria-hidden="true" /> Samo zajete objave iz javnih feedov. Brez generiranih primerov.</div>
        </section>

        <section className="dossier-column">
          <div className="dossier-column-topline">
            <span>UREDNIŠKI DOSJE</span>
            <span>{aiStatus}</span>
          </div>
          <StoryDossier story={selectedStory} onSave={(story) => void saveStory(story)} />
        </section>
      </main>
    </div>

    {notice && <div className="toast-notice" role="status" aria-live="polite"><span className="toast-dot" />{notice}</div>}
    <footer className="global-footer"><span>VEPER <b>·</b> UREDNIŠKO OBVEŠČANJE</span><span>VIRI IN NAVEDKI SO VEDNO NA DOSEGU</span></footer>
  </div>;
}
