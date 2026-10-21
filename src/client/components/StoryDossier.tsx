import { ArrowDownRight, ArrowUpRight, Bookmark, Clock3, ExternalLink, FileClock, Radio, ShieldAlert } from "lucide-react";
import type { EvidenceCitation, StoryRecord, StoredArticle } from "../../shared/types.js";
import { categoryLabels, formatDateTime, formatObservedTime, sourceCount } from "../format.js";

interface Props {
  story: StoryRecord | null;
  onSave: (story: StoryRecord) => void;
}

function SourceLink({ citation, label }: { citation: EvidenceCitation; label?: string }) {
  return <a className="source-link" href={citation.url} target="_blank" rel="noopener noreferrer"
    aria-label={`Odpri izvirnik: ${citation.publisher}`}>
    <span>{label ?? citation.publisher}</span><ExternalLink size={12} aria-hidden="true" />
  </a>;
}

function EvidenceCard({ citation, side }: { citation: EvidenceCitation; side?: string }) {
  return <article className="evidence-card">
    <div className="evidence-meta">
      <span className={`publisher-mark publisher-${citation.sourceId}`} aria-hidden="true">{citation.publisher.slice(0, 3).toLocaleUpperCase("sl-SI")}</span>
      <span className="evidence-publisher">{citation.publisher}</span>
      {side && <span className="evidence-side">{side}</span>}
    </div>
    <blockquote>{citation.quote}</blockquote>
    <div className="evidence-foot">
      <span>{citation.publishedAt ? formatDateTime(citation.publishedAt) : "čas objave ni naveden"}</span>
      <SourceLink citation={citation} label="Izvirni vir" />
    </div>
  </article>;
}

function DirectSourceCard({ article }: { article: StoredArticle }) {
  return <article className="direct-source-card">
    <div className="direct-source-heading"><span>{article.sourceName}</span><span>{formatObservedTime(article)}</span></div>
    <h4>{article.title}</h4>
    {article.summary && <p>{article.summary}</p>}
    <a className="source-link" href={article.url} target="_blank" rel="noopener noreferrer"
      aria-label={`Odpri izvirnik: ${article.sourceName}`}>
      <span>Odpri izvirnik</span><ArrowUpRight size={12} aria-hidden="true" />
    </a>
  </article>;
}

interface TimelineEntry {
  id: string;
  observedAt: string;
  timeLabel: string;
  title: string;
  summary: string;
  sourceName: string;
  url: string;
  revision: boolean;
}

function timelineOf(story: StoryRecord): TimelineEntry[] {
  return story.articles.flatMap((article) => {
    const hasPublisherUpdate = !!article.sourceUpdatedAt &&
      (!article.publishedAt || Date.parse(article.sourceUpdatedAt) > Date.parse(article.publishedAt));
    return [
      ...article.revisions.map((revision) => ({
        id: revision.id, observedAt: revision.observedAt, timeLabel: "prej zajeto · " + formatDateTime(revision.observedAt), title: revision.title, summary: revision.summary,
        sourceName: article.sourceName, url: article.url, revision: true,
      })),
      {
        id: article.id,
        observedAt: hasPublisherUpdate ? article.sourceUpdatedAt! : article.revisions.length ? article.observedAt : article.publishedAt ?? article.observedAt,
        timeLabel: hasPublisherUpdate
          ? "vir posodobil · " + formatDateTime(article.sourceUpdatedAt)
          : article.revisions.length
            ? "posodobitev zajeta · " + formatDateTime(article.observedAt)
            : article.publishedAt
              ? "objavljeno · " + formatDateTime(article.publishedAt)
              : "zajeto · " + formatDateTime(article.observedAt),
        title: article.title, summary: article.summary, sourceName: article.sourceName, url: article.url, revision: false,
      },
    ];
  }).sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
}

export function StoryDossier({ story, onSave }: Props) {
  if (!story) return <section className="dossier-empty" aria-label="Dosje zgodbe">
    <div className="dossier-empty-icon"><Radio size={24} aria-hidden="true" /></div>
    <p className="eyebrow">DOSJE ZGODBE</p>
    <h2>Izberite zgodbo za pregled</h2>
    <p>Viri, časovnica, primerjave in preverljiva uredniška vprašanja se pokažejo tukaj.</p>
  </section>;

  const uniqueSources = sourceCount(story);
  const analysis = story.analysis;
  const comparisons = analysis?.comparisons ?? [];
  const timeline = timelineOf(story);
  const hasCrossSource = uniqueSources > 1;

  return <section className="dossier" aria-label="Dosje zgodbe">
    <div className="dossier-head">
      <div className="dossier-kicker"><span>DOSJE ZGODBE</span><span className="dossier-updated"><Clock3 size={12} aria-hidden="true" /> {formatDateTime(story.updatedAt)}</span></div>
      <h2>{story.title}</h2>
      <div className="dossier-meta">
        {story.category && <span className="category-pill">{categoryLabels[story.category]}</span>}
        <span>{uniqueSources} {uniqueSources === 1 ? "javni vir" : "javna vira"}</span>
        <span>{story.articles.length} {story.articles.length === 1 ? "objava" : "objavi"}</span>
      </div>
      <button type="button" className={`save-story ${story.saved ? "is-saved" : ""}`}
        aria-label={story.saved ? "Odstrani iz shranjenih" : "Shrani zgodbo"}
        aria-pressed={story.saved} onClick={() => onSave(story)}>
        <Bookmark size={14} fill={story.saved ? "currentColor" : "none"} aria-hidden="true" />
        <span>{story.saved ? "Shranjeno" : "Shrani za oddajo"}</span>
      </button>
    </div>

    {analysis && <section className="analysis-section" aria-label="AI analiza">
      <div className="section-heading">
        <div><span className="section-index">01</span><h3>Uredniški povzetek</h3></div>
        <span className="grounding-tag"><span className="grounding-dot" /> AI PREDLOG · PREGLED PODPORE</span>
      </div>
      {analysis.briefing.length ? <ul className="briefing-list">
        {analysis.briefing.map((point, index) => <li key={`${index}-${point.text}`}>
          <p>{point.text}</p>
          <span className="citation-row">{point.evidence.map((citation) => <SourceLink key={citation.quoteHash} citation={citation} />)}</span>
        </li>)}
      </ul> : <p className="analysis-empty">V izsekih ni dovolj dokazov za varen povzetek. Izvirni zapisi so spodaj.</p>}
      <p className="ai-disclaimer">Dobesedni navedek se ujema z zajetim izsekom; ločen AI pregled oceni podporo trditve. To ni neodvisna potrditev. Pred objavo preverite izvirnik in kontekst.</p>
    </section>}

    <section className="comparison-section" aria-label="Primerjava virov">
      <div className="section-heading">
        <div><span className="section-index">02</span><h3>Primerjava poročanja</h3></div>
        {hasCrossSource && <span className="comparison-source-count">{uniqueSources} JAVNA VIRA</span>}
      </div>
      {comparisons.length > 0 ? <div className="comparison-stack">
        {comparisons.map((comparison, index) => <article className={`comparison ${comparison.kind}`} key={`${index}-${comparison.left.quoteHash}`}>
          <div className={`comparison-label ${comparison.kind === "contradiction" ? "is-conflict" : ""}`}>
            {comparison.kind === "contradiction" ? <><ShieldAlert size={13} aria-hidden="true" /> MOŽNO NESKLADJE · PREVERI</> : comparison.kind === "difference" ? "RAZLIČEN POUDAR" : "SKUPNO POROČANJE"}
          </div>
          <p className="comparison-note">{comparison.note}</p>
          <div className="comparison-grid">
            <EvidenceCard citation={comparison.left} side="POROČA" />
            <div className="comparison-divider" aria-hidden="true"><ArrowDownRight size={15} /></div>
            <EvidenceCard citation={comparison.right} side="POROČA" />
          </div>
        </article>)}
      </div> : hasCrossSource ? <>
        <p className="section-explainer">Viri poročajo o sorodnem dogodku. Izseke primerjajte neposredno; avtomatsko neskladje ni bilo potrjeno.</p>
        <div className="direct-sources">{story.articles.map((article) => <DirectSourceCard key={article.id} article={article} />)}</div>
      </> : <>
        <p className="section-explainer">Zgodbo trenutno navaja en vir. Nadaljnjih poročil še ni za primerjavo.</p>
        <div className="direct-sources">{story.articles.map((article) => <DirectSourceCard key={article.id} article={article} />)}</div>
      </>}
    </section>

    {analysis?.development && <section className="development-section" aria-label="Razvoj zgodbe">
      <div className="section-heading"><div><span className="section-index">03</span><h3>Razvoj</h3></div><ArrowDownRight size={15} aria-hidden="true" /></div>
      <p className="development-copy">{analysis.development.text}</p>
      <span className="citation-row">{analysis.development.evidence.map((citation) => <SourceLink key={citation.quoteHash} citation={citation} />)}</span>
    </section>}

    {analysis && <section className="leads-section" aria-label="Uredniški namigi">
      <div className="section-heading"><div><span className="section-index">04</span><h3>Naslednji novinarski korak</h3></div><span className="lead-mark">VPRAŠANJA ZA PREVERJANJE</span></div>
      {analysis.leads.length > 0 ? <div className="lead-list">
        {analysis.leads.map((lead, index) => <article className="lead-card" key={`${index}-${lead.question}`}>
          <span className="lead-question-mark">?</span><div><h4>{lead.question}</h4><p>{lead.rationale}</p>
            <span className="citation-row">{lead.evidence.map((citation) => <SourceLink key={citation.quoteHash} citation={citation} />)}</span>
          </div>
        </article>)}
      </div> : <p className="analysis-empty">Utemeljenega vprašanja za preverjanje še ni.</p>}
    </section>}

    <section className="timeline-section" aria-label="Časovnica razvoja zgodbe">
      <div className="section-heading"><div><span className="section-index">{analysis ? "05" : "03"}</span><h3>Časovnica vira</h3></div><FileClock size={15} aria-hidden="true" /></div>
      <ol className="story-timeline">
        {timeline.map((entry) => <li key={entry.id} className={entry.revision ? "timeline-revision" : ""}>
          <span className="timeline-point" aria-hidden="true" />
          <div className="timeline-entry">
            <div className="timeline-meta"><strong>{entry.sourceName}</strong><time dateTime={entry.observedAt}>{entry.timeLabel}</time></div>
            {entry.revision && <span className="revision-label">PREJŠNJI IZSEK</span>}
            <h4>{entry.title}</h4>
            {entry.summary && <p>{entry.summary}</p>}
            <a className="source-link" href={entry.url} target="_blank" rel="noopener noreferrer" aria-label={`Odpri izvirnik: ${entry.sourceName}`}>
              <span>Odpri vir</span><ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>
        </li>)}
      </ol>
    </section>
    <footer className="dossier-footer"><ShieldAlert size={13} aria-hidden="true" /><span>Analiza je uredniški namig, ne potrditev resničnosti dogodka.</span></footer>
  </section>;
}
