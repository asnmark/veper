import { Activity, Bookmark, Globe2, RadioTower, ShieldAlert, SlidersHorizontal, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SourceHealth, StoryRecord } from "../../shared/types.js";
import { formatClock, isDevelopingStory, relativeTime, sourceStateLabel } from "../format.js";

export type DeskFilter = "all" | "developing" | "discrepancies" | "multi-source" | "saved" | "si" | "world";

interface Props {
  filter: DeskFilter;
  onFilter: (filter: DeskFilter) => void;
  sources: SourceHealth[];
  stories: StoryRecord[];
  now: string;
  open: boolean;
  onClose: () => void;
}

const Filters: Array<{ id: DeskFilter; label: string; Icon: typeof Activity }> = [
  { id: "all", label: "Vse zgodbe", Icon: Activity },
  { id: "developing", label: "V razvoju", Icon: RadioTower },
  { id: "discrepancies", label: "Možna neskladja", Icon: ShieldAlert },
  { id: "multi-source", label: "Več virov", Icon: UsersRound },
  { id: "saved", label: "Shranjeno", Icon: Bookmark },
  { id: "si", label: "Slovenija", Icon: RadioTower },
  { id: "world", label: "Svet", Icon: Globe2 },
];

function countStories(filter: DeskFilter, stories: StoryRecord[], now: string): number {
  if (filter === "all") return stories.length;
  if (filter === "developing") return stories.filter((story) => isDevelopingStory(story, now)).length;
  if (filter === "discrepancies") return stories.filter((story) => story.analysis?.comparisons.some((entry) => entry.kind !== "agreement")).length;
  if (filter === "multi-source") return stories.filter((story) => new Set(story.articles.map((article) => article.sourceId)).size > 1).length;
  if (filter === "saved") return stories.filter((story) => story.saved).length;
  if (filter === "si") return stories.filter((story) => story.articles.some((article) => article.region === "si")).length;
  return stories.filter((story) => story.articles.some((article) => article.region === "world")).length;
}

export function SourceRail({ filter, onFilter, sources, stories, now, open, onClose }: Props) {
  const [isMobile, setIsMobile] = useState(false);
  const firstFilter = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (isMobile && open) firstFilter.current?.focus();
  }, [isMobile, open]);

  return <>
    {open && <button className="rail-scrim" aria-label="Zapri filtre" onClick={onClose} />}
    <aside id="source-rail" className={`source-rail ${open ? "is-open" : ""}`}
      aria-label="Uredniški filtri in stanje virov" aria-hidden={isMobile && !open} inert={isMobile && !open}>
      <div className="rail-section-title"><span>UREDNIŠKI POGLED</span><SlidersHorizontal size={13} aria-hidden="true" /></div>
      <nav className="rail-filters" aria-label="Filtriranje zgodb">
        {Filters.map(({ id, label, Icon }, index) => <button
          key={id}
          ref={index === 0 ? firstFilter : undefined}
          type="button"
          className={`rail-filter ${filter === id ? "is-active" : ""}`}
          aria-label={`Filter: ${label === "Možna neskladja" ? "možna neskladja" : label.toLocaleLowerCase("sl-SI")}`}
          aria-pressed={filter === id}
          onClick={() => { onFilter(id); onClose(); }}
        >
          <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>{label}</span>
          <small>{countStories(id, stories, now)}</small>
        </button>)}
      </nav>

      <section className="source-health" aria-labelledby="source-health-title">
        <div className="rail-section-title" id="source-health-title">
          <span>JAVNI VIRI</span><span className="source-total">{sources.length}</span>
        </div>
        {sources.length === 0 ? <p className="rail-empty">Viri še niso nastavljeni.</p> : <ul>
          {sources.map((source) => <li key={source.id} className={`health-row state-${source.state}`}>
            <span className="health-dot" aria-hidden="true" />
            <span className="health-name" title={source.lastError ?? source.name}>{source.name}</span>
            <span className="health-label">{sourceStateLabel(source.state)}</span>
            <span className="health-time">{source.lastSuccessAt ? formatClock(source.lastSuccessAt) : "—"}</span>
            {source.lastError && <span className="health-error" title={source.lastError}>Napaka: {source.lastError}</span>}
          </li>)}
        </ul>}
      </section>

      <div className="rail-footnote">
        <span className="privacy-mark"><ShieldAlert size={14} aria-hidden="true" /></span>
        <p>Analiza ostaja vezana na javne izseke in izvirne povezave.</p>
      </div>
    </aside>
  </>;
}
