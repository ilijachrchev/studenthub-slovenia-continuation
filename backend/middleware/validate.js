function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function isString(value) {
    return typeof value === "string";
}

function isValidEmail(email) {
    if (!isString(email)) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
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

function validateRegistration(body) {
    const errors = [];
    const e = validateFieldLength(body.first_name, "First name", 100, true);
    if (e) errors.push(e);
    const e2 = validateFieldLength(body.last_name, "Last name", 100, true);
    if (e2) errors.push(e2);
    const e3 = validateFieldLength(body.email, "Email", 255, true);
    if (e3) errors.push(e3);
    else if (!isValidEmail(body.email)) errors.push("Invalid email format");
    const e4 = validateFieldLength(body.password, "Password", 128, true);
    if (e4) errors.push(e4);
    else if (body.password.length < 8) errors.push("Password must be at least 8 characters");
    return errors;
}

function validatePasswordChange(body) {
    const errors = [];
    const e = validateFieldLength(body.new_password, "New password", 128, true);
    if (e) errors.push(e);
    else if (body.new_password.length < 8) errors.push("Password must be at least 8 characters");
    return errors;
}

function validateOrganization(body) {
    const errors = [];
    const e = validateFieldLength(body.name, "Organization name", 255, true);
    if (e) errors.push(e);
    const e2 = validateFieldLength(body.contact_email, "Contact email", 255, true);
    if (e2) errors.push(e2);
    else if (!isValidEmail(body.contact_email)) errors.push("Invalid email format");
    const e3 = validateFieldLength(body.description, "Description", 5000);
    if (e3) errors.push(e3);
    const e4 = validateFieldLength(body.website, "Website", 500);
    if (e4) errors.push(e4);
    return errors;
}

function validateEvent(body) {
    const errors = [];
    const e = validateFieldLength(body.title, "Title", 255, true);
    if (e) errors.push(e);
    const e2 = validateFieldLength(body.location, "Location", 255, true);
    if (e2) errors.push(e2);
    const e3 = validateFieldLength(body.description, "Description", 5000);
    if (e3) errors.push(e3);
    const e4 = validateFieldLength(body.external_url, "External URL", 500);
    if (e4) errors.push(e4);
    return errors;
}

function validateOpportunity(body, { partial = false } = {}) {
    const errors = [];

    const e = validateFieldLength(body.title, "Title", 255, !partial || body.title !== undefined);
    if (e) errors.push(e);

    const e2 = validateFieldLength(body.description, "Description", 5000);
    if (e2) errors.push(e2);

    const e3 = validateFieldLength(body.location, "Location", 255);
    if (e3) errors.push(e3);

    const deadlineRequired = !partial || body.deadline !== undefined;
    if (deadlineRequired) {
        if (!isNonEmptyString(body.deadline) && !(body.deadline instanceof Date)) {
            errors.push("Deadline is required");
        } else {
            const deadline = new Date(body.deadline);
            if (Number.isNaN(deadline.getTime())) {
                errors.push("Deadline must be a valid date");
            } else if (deadline.getTime() <= Date.now()) {
                errors.push("Deadline must be in the future");
            }
        }
    }

    return errors;
}

function validateFeedback(body) {
    const errors = [];
    const e = validateFieldLength(body.comment, "Comment", 2000);
    if (e) errors.push(e);
    return errors;
}

module.exports = {
    isValidEmail,
    validateFieldLength,
    validateRegistration,
    validatePasswordChange,
    validateOrganization,
    validateEvent,
    validateOpportunity,
    validateFeedback,
};
