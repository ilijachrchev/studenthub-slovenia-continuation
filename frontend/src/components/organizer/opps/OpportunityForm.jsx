import { useState } from "react";

const EMPTY_FORM = {
  title: "",
  summary: "",
  description: "",
  location: "",
  application_deadline: "",
  start_date: "",
  end_date: "",
  capacity: "",
  compensation: "",
  contact_email: "",
  apply_url: "",
  tags: "",
};

function toFormValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function buildFormValue(opportunity) {
  if (!opportunity) return EMPTY_FORM;
  return {
    title: opportunity.title || "",
    summary: opportunity.summary || "",
    description: opportunity.description || "",
    location: opportunity.location || "",
    application_deadline: toFormValue(opportunity.application_deadline || opportunity.deadline),
    start_date: toFormValue(opportunity.start_date || opportunity.starts_at),
    end_date: toFormValue(opportunity.end_date || opportunity.ends_at),
    capacity: opportunity.capacity ?? "",
    compensation: opportunity.compensation || "",
    contact_email: opportunity.contact_email || "",
    apply_url: opportunity.apply_url || "",
    tags: Array.isArray(opportunity.tags) ? opportunity.tags.join(", ") : opportunity.tags || "",
  };
}

function validateForm(form) {
  const errors = {};
  if (!form.title.trim()) errors.title = "Title is required.";
  if (form.title.trim().length < 3) errors.title = "Title must be at least 3 characters.";
  if (!form.description.trim()) errors.description = "Description is required.";
  if (form.description.trim().length < 20) errors.description = "Description must be at least 20 characters.";
  if (!form.location.trim()) errors.location = "Location is required.";
  if (!form.application_deadline) errors.application_deadline = "Application deadline is required.";
  if (!form.start_date) errors.start_date = "Start date is required.";
  if (!form.end_date) errors.end_date = "End date is required.";
  if (form.application_deadline && form.start_date && new Date(form.application_deadline) > new Date(form.start_date)) {
    errors.start_date = "Start date must be after the application deadline.";
  }
  if (form.start_date && form.end_date && new Date(form.start_date) > new Date(form.end_date)) {
    errors.end_date = "End date must be after the start date.";
  }
  if (form.capacity && Number(form.capacity) < 1) errors.capacity = "Capacity must be at least 1.";
  if (form.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email)) {
    errors.contact_email = "Enter a valid email address.";
  }
  if (form.apply_url && !/^https?:\/\//i.test(form.apply_url)) {
    errors.apply_url = "Application link must start with http:// or https://.";
  }
  return errors;
}

function OpportunityForm({ opportunity, onSubmit, onCancel, saving, serverError }) {
  const [form, setForm] = useState(() => buildFormValue(opportunity));
  const [errors, setErrors] = useState({});

  const update = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const nextErrors = validateForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSubmit({
      ...form,
      capacity: form.capacity === "" ? null : Number(form.capacity),
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
  };

  const fieldError = (name) => errors[name];

  return (
    <section className="opp-form-panel" aria-labelledby="opportunity-form-title">
      <div className="opp-form-header">
        <div>
          <h2 id="opportunity-form-title">{opportunity ? "Edit opportunity" : "Create opportunity"}</h2>
          <p className="opp-form-subtitle">
            Draft changes stay local until you save them, then you can submit, close, or archive from the list.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Clear
        </button>
      </div>

      {(serverError || Object.keys(errors).length > 0) && (
        <div className="opp-form-alert" role="alert" aria-live="polite">
          {serverError && <p>{serverError}</p>}
          {Object.values(errors).map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}

      <form className="opp-form" onSubmit={handleSubmit}>
        <label>
          <span>Title</span>
          <input className="input" value={form.title} onChange={update("title")} maxLength={120} />
          {fieldError("title") && <small>{fieldError("title")}</small>}
        </label>
        <label>
          <span>Summary</span>
          <input className="input" value={form.summary} onChange={update("summary")} maxLength={180} />
        </label>
        <label className="opp-form-span-2">
          <span>Description</span>
          <textarea className="input" rows={5} value={form.description} onChange={update("description")} />
          {fieldError("description") && <small>{fieldError("description")}</small>}
        </label>
        <label>
          <span>Location</span>
          <input className="input" value={form.location} onChange={update("location")} />
          {fieldError("location") && <small>{fieldError("location")}</small>}
        </label>
        <label>
          <span>Capacity</span>
          <input className="input" type="number" min="1" value={form.capacity} onChange={update("capacity")} />
          {fieldError("capacity") && <small>{fieldError("capacity")}</small>}
        </label>
        <label>
          <span>Application deadline</span>
          <input className="input" type="datetime-local" value={form.application_deadline} onChange={update("application_deadline")} />
          {fieldError("application_deadline") && <small>{fieldError("application_deadline")}</small>}
        </label>
        <label>
          <span>Start date</span>
          <input className="input" type="datetime-local" value={form.start_date} onChange={update("start_date")} />
          {fieldError("start_date") && <small>{fieldError("start_date")}</small>}
        </label>
        <label>
          <span>End date</span>
          <input className="input" type="datetime-local" value={form.end_date} onChange={update("end_date")} />
          {fieldError("end_date") && <small>{fieldError("end_date")}</small>}
        </label>
        <label>
          <span>Compensation</span>
          <input className="input" value={form.compensation} onChange={update("compensation")} />
        </label>
        <label>
          <span>Contact email</span>
          <input className="input" type="email" value={form.contact_email} onChange={update("contact_email")} />
          {fieldError("contact_email") && <small>{fieldError("contact_email")}</small>}
        </label>
        <label>
          <span>Application link</span>
          <input className="input" value={form.apply_url} onChange={update("apply_url")} />
          {fieldError("apply_url") && <small>{fieldError("apply_url")}</small>}
        </label>
        <label className="opp-form-span-2">
          <span>Tags</span>
          <input className="input" value={form.tags} onChange={update("tags")} placeholder="Research, design, part-time" />
        </label>

        <div className="opp-form-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary btn-primary-inline" disabled={saving}>
            {saving ? "Saving..." : opportunity ? "Update draft" : "Create draft"}
          </button>
        </div>
      </form>
    </section>
  );
}

export default OpportunityForm;


