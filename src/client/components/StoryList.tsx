import { AlertTriangle, ArrowUpRight, Bookmark, Layers3, Radio } from "lucide-react";
import type { StoryRecord } from "../../shared/types.js";
import { categoryLabels, formatObservedTime, relativeTime, sourceCount } from "../format.js";

interface Props {
  stories: StoryRecord[];
  selectedId: string | null;
  now: string;
  onSelect: (storyId: string) => void;
}

function SourceMarks({ story }: { story: StoryRecord }) {
  const sources = [...new Map(story.articles.map((article) => [article.sourceId, article.sourceName])).entries()];
  return <span className="source-marks" aria-label={`${sources.length} ${sources.length === 1 ? "vir" : "virov"}`}>
    {sources.slice(0, 3).map(([id, name]) => <span key={id} className="source-mark" title={name}>{name.slice(0, 3).toLocaleUpperCase("sl-SI")}</span>)}
    {sources.length > 3 && <span className="source-mark source-mark-more">+{sources.length - 3}</span>}
  </span>;
}

export function StoryList({ stories, selectedId, now, onSelect }: Props) {
  if (stories.length === 0) return <div className="filtered-empty">
    <div className="empty-mark"><Radio size={20} aria-hidden="true" /></div>
    <h3>Ta pogled je trenutno prazen</h3>
    <p>Ko se pojavi nova objava iz izbranih virov, se bo pokazala tukaj.</p>
  </div>;

  return <div className="story-list" role="list" aria-label="Zaznane zgodbe">
    {stories.map((story, index) => {
      const sourceTotal = sourceCount(story);
      const contradiction = story.analysis?.comparisons.some((entry) => entry.kind === "contradiction") ?? false;
      const divergence = story.analysis?.comparisons.some((entry) => entry.kind === "difference") ?? false;
      const lead = story.analysis?.briefing[0];
      const latest = story.articles[0];
      const excerpt = lead?.text ?? latest?.summary ?? "Vir ni objavil besedilnega izseka.";

      return <article key={story.id} className={`story-item ${selectedId === story.id ? "is-selected" : ""}`} role="listitem">
        <button
          type="button"
          className="story-select"
          aria-label={`Odpri zgodbo: ${story.title}`}
          aria-pressed={selectedId === story.id}
          onClick={() => onSelect(story.id)}
        >
          <span className="story-overline">
            <span className={`story-label ${contradiction ? "label-conflict" : sourceTotal > 1 ? "label-sources" : "label-single"}`}>
              {contradiction ? <><AlertTriangle size={11} aria-hidden="true" /> MOŽNO NESKLADJE</> : sourceTotal > 1 ? <><Layers3 size={11} aria-hidden="true" /> {sourceTotal} VIRA</> : "EN VIR"}
            </span>
            <span className="story-updated" title={latest ? formatObservedTime(latest) : undefined}>{relativeTime(story.updatedAt, now)}</span>
          </span>
          <h3>{story.title}</h3>
          <p className="story-excerpt">{excerpt}</p>
          {lead && <span className="story-citations" aria-label="Dokazi v virih">
            {lead.evidence.slice(0, 2).map((citation) => <span key={`${citation.articleId}-${citation.quoteHash}`}>{citation.publisher}<ArrowUpRight size={10} aria-hidden="true" /></span>)}
          </span>}
          {!lead && latest && <span className="story-citations"><span>{latest.sourceName}<ArrowUpRight size={10} aria-hidden="true" /></span></span>}
          <span className="story-footer">
            <SourceMarks story={story} />
            <span className="story-footer-meta">{story.category ? categoryLabels[story.category] : "Brez rubrike"}</span>
            {story.saved && <Bookmark className="saved-mark" size={13} fill="currentColor" aria-label="Shranjeno" />}
          </span>
        </button>
        {divergence && !contradiction && <span className="divergence-dot" aria-label="Viri poudarjajo različne podrobnosti" />}
        {index === 0 && <span className="visually-hidden">Najnovejša zgodba</span>}
      </article>;
    })}
  </div>;
}
