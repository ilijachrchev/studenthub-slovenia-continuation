import "./css/opportunities.css";

const AVAILABILITY_OPTIONS = [
  { value: "", label: "All" },
  { value: "open", label: "Open now" },
  { value: "closed", label: "Closed" },
];

function OpportunityFilters({
  values,
  organizers = [],
  onChange,
  onClear,
}) {
  const handleChange = (key) => (event) => {
    onChange(key, event.target.value);
  };

  return (
    <section className="opp-filters" aria-label="Opportunity filters">
      <div className="opp-filter-grid">
        <label className="opp-field">
          <span>Search</span>
          <input
            type="search"
            value={values.search}
            onChange={handleChange("search")}
            placeholder="Search titles, descriptions, or organizers"
          />
        </label>

        <label className="opp-field">
          <span>Organizer</span>
          <select value={values.organizer} onChange={handleChange("organizer")}>
            <option value="">All organizers</option>
            {organizers.map((organizer) => (
              <option key={organizer.value} value={organizer.value}>
                {organizer.label}
              </option>
            ))}
          </select>
        </label>

        <label className="opp-field">
          <span>Availability</span>
          <select value={values.availability} onChange={handleChange("availability")}>
            {AVAILABILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="opp-field">
          <span>Location</span>
          <input
            type="text"
            value={values.location}
            onChange={handleChange("location")}
            placeholder="Filter by city or venue"
          />
        </label>

        <label className="opp-field">
          <span>Due before</span>
          <input
            type="date"
            value={values.deadline}
            onChange={handleChange("deadline")}
          />
        </label>
      </div>

      <div className="opp-filter-actions">
        <button type="button" className="opp-filter-reset" onClick={onClear}>
          Clear filters
        </button>
      </div>
    </section>
  );
}

export default OpportunityFilters;

