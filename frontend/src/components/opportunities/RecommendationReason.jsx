import "./css/opportunities.css";

function RecommendationReason({ reason }) {
  if (!reason) return null;

  return (
    <p className="opp-reason" title="Why am I seeing this?">
      <strong>Why am I seeing this?</strong> {reason}
    </p>
  );
}

export default RecommendationReason;

