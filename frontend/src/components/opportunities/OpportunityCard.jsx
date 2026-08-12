import { Link } from "react-router-dom";
import { Bookmark, Sparkle } from "../reusable/Icons";
import RecommendationReason from "./RecommendationReason";
import { formatDate, normaliseOpportunity } from "./opportunitiesUtils";
import "./css/opportunities.css";

function OpportunityCard({
  opportunity,
  saved = false,
  onToggleSave,
  recommendationReason = "",
}) {
  const item = normaliseOpportunity(opportunity);

  const handleSaveClick = (event) => {
    if (!onToggleSave) return;
    event.preventDefault();
    event.stopPropagation();
    onToggleSave(item);
  };

  return (
    <article className="opp-card">
      <Link to={`/opportunities/${item.id}`} className="opp-card-link">
        <div className="opp-card-head">
          <div className="opp-chip-row">
            {item.category?.name && <span className="opp-chip">{item.category.name}</span>}
            {item.remote && <span className="opp-chip muted">Remote</span>}
          </div>

          <div className="opp-card-actions">
            {recommendationReason && (
              <span className="opp-rec-pill">
                <Sparkle size={13} />
                Recommended
              </span>
            )}

            {onToggleSave && (
              <button
                type="button"
                className={`opp-save-btn ${saved ? "saved" : ""}`}
                onClick={handleSaveClick}
                aria-label={saved ? "Remove saved opportunity" : "Save opportunity"}
              >
                <Bookmark size={18} filled={saved} />
              </button>
            )}
          </div>
        </div>

        <h2 className="opp-title">{item.title}</h2>
        <p className="opp-org">
          {item.organizationName || "Independent"}
          {item.organizationId ? (
            <>
              {" "}
              · <span className="opp-org-id">#{item.organizationId}</span>
            </>
          ) : null}
        </p>

        <div className="opp-meta">
          <span>{item.location}</span>
          <span>Deadline: {formatDate(item.deadline)}</span>
        </div>

        {item.tags.length > 0 && (
          <div className="opp-tags">
            {item.tags.map((tag) => (
              <span key={tag.id ?? tag.name} className="opp-tag">
                {tag.name}
              </span>
            ))}
          </div>
        )}

        <p className="opp-desc">{item.description}</p>
      </Link>

      {recommendationReason && (
        <RecommendationReason reason={recommendationReason} />
      )}
    </article>
  );
}

export default OpportunityCard;



