import "./css/opportunities.css";

const REMOTE_OPTIONS = [
  { value: "", label: "All" },
  { value: "remote", label: "Remote" },
  { value: "onsite", label: "On-site" },
];

function OpportunityFilters({
  values,
  categories = [],
  tags = [],
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
            placeholder="Search opportunities"
          />
        </label>

        <label className="opp-field">
          <span>Category</span>
          <select value={values.category} onChange={handleChange("category")}>
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </label>

        <label className="opp-field">
          <span>Tag</span>
          <select value={values.tag} onChange={handleChange("tag")}>
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag.value} value={tag.value}>
                {tag.label}
              </option>
            ))}
          </select>
        </label>

        <label className="opp-field">
          <span>Remote</span>
          <select value={values.remote} onChange={handleChange("remote")}>
            {REMOTE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="opp-field">
          <span>Deadline</span>
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



