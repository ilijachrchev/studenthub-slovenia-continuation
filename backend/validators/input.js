function isString(value) {
  return typeof value === "string";
}

function normalizeString(value) {
  if (!isString(value)) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateStringField(value, label, maxLength, { required = false } = {}) {
  if (required) {
    const normalized = normalizeString(value);
    if (!normalized) {
      return { value: null, error: `${label} is required` };
    }
    if (normalized.length > maxLength) {
      return { value: null, error: `${label} must be ${maxLength} characters or fewer` };
    }
    return { value: normalized, error: null };
  }

  if (value == null) {
    return { value: null, error: null };
  }

  if (!isString(value)) {
    return { value: null, error: `${label} must be a string` };
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return { value: null, error: null };
  }

  if (normalized.length > maxLength) {
    return { value: null, error: `${label} must be ${maxLength} characters or fewer` };
  }

  return { value: normalized, error: null };
}

function parsePositiveInteger(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value, 10);
    return parsed > 0 ? parsed : null;
  }

  return null;
}

function validatePositiveIntegerField(value, label, { required = false } = {}) {
  if (value == null || value === "") {
    return required
      ? { value: null, error: `${label} is required` }
      : { value: null, error: null };
  }

  const parsed = parsePositiveInteger(value);
  if (!parsed) {
    return { value: null, error: `${label} must be a positive integer` };
  }

  return { value: parsed, error: null };
}

function validatePositiveIntegerArray(value, label, { required = false, minLength = 0 } = {}) {
  if (value == null) {
    return required
      ? { value: null, error: `${label} is required` }
      : { value: [], error: null };
  }

  if (!Array.isArray(value)) {
    return { value: null, error: `${label} must be an array` };
  }

  if (value.length < minLength) {
    return { value: null, error: `${label} must contain at least ${minLength} item(s)` };
  }

  const normalized = [];
  for (const item of value) {
    const parsed = parsePositiveInteger(item);
    if (!parsed) {
      return { value: null, error: `${label} must contain positive integer IDs` };
    }
    normalized.push(parsed);
  }

  return { value: normalized, error: null };
}

function validateEnumField(value, label, allowedValues, { required = false } = {}) {
  if (value == null || value === "") {
    return required
      ? { value: null, error: `${label} is required` }
      : { value: null, error: null };
  }

  if (!isString(value)) {
    return { value: null, error: `${label} must be a string` };
  }

  const normalized = value.trim().toLowerCase();
  if (!allowedValues.includes(normalized)) {
    return {
      value: null,
      error: `${label} must be one of: ${allowedValues.join(", ")}`,
    };
  }

  return { value: normalized, error: null };
}

function validateDateTimeField(value, label, { required = false } = {}) {
  if (value == null || value === "") {
    return required
      ? { value: null, error: `${label} is required` }
      : { value: null, error: null };
  }

  if (!isString(value)) {
    return { value: null, error: `${label} must be a valid date and time` };
  }

  const normalized = value.trim();
  const timestamp = Date.parse(normalized);
  if (Number.isNaN(timestamp)) {
    return { value: null, error: `${label} must be a valid date and time` };
  }

  return { value: normalized, error: null, timestamp };
}

function validateDateTimeOrder(startValue, endValue, startLabel, endLabel) {
  const start = validateDateTimeField(startValue, startLabel, { required: true });
  if (start.error) {
    return start;
  }

  const end = validateDateTimeField(endValue, endLabel, { required: true });
  if (end.error) {
    return end;
  }

  if (new Date(end.timestamp) <= new Date(start.timestamp)) {
    return {
      value: null,
      error: `${endLabel} must be after ${startLabel}`,
    };
  }

  return {
    value: {
      start_datetime: start.value,
      end_datetime: end.value,
    },
    error: null,
  };
}

function validateOrganizationInput(body) {
  const errors = [];
  const name = validateStringField(body.name, "Organization name", 255, { required: true });
  if (name.error) errors.push(name.error);

  const contactEmail = validateStringField(body.contact_email, "Contact email", 255, { required: true });
  if (contactEmail.error) errors.push(contactEmail.error);

  const description = validateStringField(body.description, "Description", 5000);
  if (description.error) errors.push(description.error);

  const website = validateStringField(body.website, "Website", 500);
  if (website.error) errors.push(website.error);

  const logo = validateStringField(body.logo, "Logo", 500);
  if (logo.error) errors.push(logo.error);

  const universityId = validatePositiveIntegerField(body.university_id, "University");
  if (universityId.error) errors.push(universityId.error);

  return {
    errors,
    value: {
      name: name.value,
      contact_email: contactEmail.value,
      description: description.value,
      website: website.value,
      logo: logo.value,
      university_id: universityId.value,
    },
  };
}

function validateEventInput(body) {
  const errors = [];
  const title = validateStringField(body.title, "Title", 255, { required: true });
  if (title.error) errors.push(title.error);

  const location = validateStringField(body.location, "Location", 255, { required: true });
  if (location.error) errors.push(location.error);

  const description = validateStringField(body.description, "Description", 5000);
  if (description.error) errors.push(description.error);

  const externalUrl = validateStringField(body.external_url, "External URL", 500);
  if (externalUrl.error) errors.push(externalUrl.error);

  const dateRange = validateDateTimeOrder(body.start_datetime, body.end_datetime, "Start datetime", "End datetime");
  if (dateRange.error) errors.push(dateRange.error);

  const tagIds = validatePositiveIntegerArray(body.tag_ids, "Tag IDs", { required: true, minLength: 1 });
  if (tagIds.error) errors.push(tagIds.error);

  const targetFacultyIds = validatePositiveIntegerArray(body.target_faculty_ids, "Target faculty IDs", {
    required: true,
    minLength: 1,
  });
  if (targetFacultyIds.error) errors.push(targetFacultyIds.error);

  const registrationType = validateEnumField(body.registration_type, "Registration type", [
    "built_in",
    "external",
    "none",
  ]);
  if (registrationType.error) errors.push(registrationType.error);

  const capacity = validatePositiveIntegerField(body.capacity, "Capacity");
  if (capacity.error) errors.push(capacity.error);

  return {
    errors,
    value: {
      title: title.value,
      description: description.value,
      location: location.value,
      external_url: externalUrl.value,
      start_datetime: dateRange.value ? dateRange.value.start_datetime : null,
      end_datetime: dateRange.value ? dateRange.value.end_datetime : null,
      tag_ids: tagIds.value || [],
      target_faculty_ids: targetFacultyIds.value || [],
      registration_type: registrationType.value,
      capacity: capacity.value,
    },
  };
}

function validateStudentProfileInput(body) {
  const errors = [];
  const facultyId = validatePositiveIntegerField(body.faculty_id, "Faculty", { required: true });
  if (facultyId.error) errors.push(facultyId.error);

  const studyYear = validatePositiveIntegerField(body.study_year, "Study year");
  if (studyYear.error) errors.push(studyYear.error);

  const tagIds = validatePositiveIntegerArray(body.tag_ids, "Tag IDs");
  if (tagIds.error) errors.push(tagIds.error);

  return {
    errors,
    value: {
      faculty_id: facultyId.value,
      study_year: studyYear.value,
      tag_ids: tagIds.value || [],
    },
  };
}

function validateCoverNoteInput(body) {
  const coverNote = validateStringField(body.cover_note, "Cover note", 5000);
  return {
    errors: coverNote.error ? [coverNote.error] : [],
    value: {
      cover_note: coverNote.value,
    },
  };
}

function validateApplicationTransitionInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      errors: ["Both from and to statuses are required"],
      value: null,
    };
  }

  const from = normalizeString(body.from_status || body.from || body.current_status);
  const to = normalizeString(body.to_status || body.to || body.next_status);

  if (!from || !to) {
    return {
      errors: ["Both from and to statuses are required"],
      value: null,
    };
  }

  return {
    errors: [],
    value: {
      from,
      to,
    },
  };
}

function validateRejectionReasonInput(body) {
  const reason = validateStringField(body.reason, "Rejection reason", 2000, { required: true });
  return {
    errors: reason.error ? [reason.error] : [],
    value: {
      reason: reason.value,
    },
  };
}

function validateNotificationPreferencesInput(body) {
  const preferences = body && typeof body.preferences === "object" ? body.preferences : body;

  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    return {
      errors: ["Preferences must be an object"],
      value: null,
    };
  }

  return {
    errors: [],
    value: preferences,
  };
}

module.exports = {
  normalizeString,
  parsePositiveInteger,
  validateStringField,
  validatePositiveIntegerField,
  validatePositiveIntegerArray,
  validateEnumField,
  validateDateTimeField,
  validateDateTimeOrder,
  validateOrganizationInput,
  validateEventInput,
  validateStudentProfileInput,
  validateCoverNoteInput,
  validateApplicationTransitionInput,
  validateRejectionReasonInput,
  validateNotificationPreferencesInput,
};
