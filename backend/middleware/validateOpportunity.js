function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isString(value) {
  return typeof value === "string";
}

function isValidDateString(value) {
  if (!isString(value) || !value.trim()) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function validateFieldLength(value, name, max, required = false) {
  if (required && !isNonEmptyString(value)) {
    return `${name} is required`;
  }
  if (value != null && isString(value) && value.length > max) {
    return `${name} must be ${max} characters or fewer`;
  }
  return null;
}

function validateOpportunity(body, options = {}) {
  const {
    partial = false,
    requireTags = false,
  } = options;

  const errors = [];

  const titleError = validateFieldLength(body.title, "Title", 255, !partial);
  if (titleError) errors.push(titleError);

  const descriptionError = validateFieldLength(body.description, "Description", 5000);
  if (descriptionError) errors.push(descriptionError);

  const locationError = validateFieldLength(body.location, "Location", 255);
  if (locationError) errors.push(locationError);

  const typeError = validateFieldLength(body.type, "Type", 30);
  if (typeError) errors.push(typeError);

  const modeError = validateFieldLength(body.application_mode, "Application mode", 20);
  if (modeError) errors.push(modeError);

  const urlError = validateFieldLength(body.external_url, "External URL", 500);
  if (urlError) errors.push(urlError);

  const compensationError = validateFieldLength(body.compensation, "Compensation", 120);
  if (compensationError) errors.push(compensationError);

  if (body.category_id != null && body.category_id !== "") {
    if (!isPositiveInteger(Number(body.category_id))) {
      errors.push("Category id must be a positive integer");
    }
  }

  if (body.capacity != null && body.capacity !== "") {
    const capacity = Number(body.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      errors.push("Capacity must be a positive integer");
    }
  }

  if (body.starts_at != null && body.starts_at !== "" && !isValidDateString(body.starts_at)) {
    errors.push("Starts at must be a valid date");
  }

  if (body.application_deadline != null && body.application_deadline !== "" && !isValidDateString(body.application_deadline)) {
    errors.push("Application deadline must be a valid date");
  }

  if (body.is_remote != null && body.is_remote !== "" && typeof body.is_remote !== "boolean" && body.is_remote !== "true" && body.is_remote !== "false" && body.is_remote !== "1" && body.is_remote !== "0") {
    errors.push("Remote must be a boolean");
  }

  if (body.tag_ids != null) {
    if (!Array.isArray(body.tag_ids)) {
      errors.push("Tag ids must be an array");
    } else {
      const invalidTag = body.tag_ids.find((tagId) => !isPositiveInteger(Number(tagId)));
      if (invalidTag != null) {
        errors.push("Tag ids must contain only positive integers");
      } else if ((requireTags || (!partial && body.tag_ids.length === 0)) && body.tag_ids.length === 0) {
        errors.push("Select at least one tag");
      }
    }
  } else if (requireTags && !partial) {
    errors.push("Select at least one tag");
  }

  return errors;
}

module.exports = { validateOpportunity };


