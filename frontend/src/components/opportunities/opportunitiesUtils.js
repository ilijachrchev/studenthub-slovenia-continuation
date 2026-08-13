export function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

export function formatDateTime(value) {
  if (!value) return "TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value) {
  if (!value) return "TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function isPastDate(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < Date.now();
}

export function normaliseTags(source) {
  return toArray(source)
    .map((tag) => {
      if (typeof tag === "string") {
        return { id: tag, name: tag };
      }

      if (!tag || typeof tag !== "object") {
        return null;
      }

      const id = tag.id ?? tag.tag_id ?? tag.value ?? tag.slug ?? tag.name;
      const name = tag.name ?? tag.label ?? tag.tag_name ?? String(id ?? "");
      if (!name) return null;

      return { ...tag, id, name };
    })
    .filter(Boolean);
}

export function normaliseOpportunity(opportunity = {}) {
  const tags = normaliseTags(
    opportunity.tags ??
      opportunity.tag_list ??
      opportunity.opportunity_tags ??
      opportunity.opportunityTags
  );

  const category =
    opportunity.category ??
    opportunity.category_name ??
    opportunity.categoryName ??
    (opportunity.category_id ? { id: opportunity.category_id, name: opportunity.category_name ?? opportunity.category } : null);

  const organization =
    opportunity.organization ??
    (opportunity.organization_id || opportunity.organization_name
      ? {
          id: opportunity.organization_id,
          name: opportunity.organization_name,
          slug: opportunity.organization_slug,
          website: opportunity.organization_website,
        }
      : null);

  const appliedState =
    opportunity.application_status ??
    opportunity.current_application_status ??
    opportunity.user_application_status ??
    (opportunity.has_applied ? "applied" : "");

  return {
    ...opportunity,
    id: opportunity.id ?? opportunity.opportunity_id,
    title: opportunity.title ?? opportunity.name ?? "Untitled opportunity",
    description: opportunity.description ?? "",
    category,
    categoryId:
      opportunity.category_id ??
      opportunity.category?.id ??
      opportunity.categoryId ??
      null,
    remote: Boolean(
      opportunity.remote ??
        opportunity.is_remote ??
        opportunity.remote_allowed ??
        opportunity.remoteAllowed
    ),
    deadline:
      opportunity.deadline ??
      opportunity.application_deadline ??
      opportunity.deadline_at ??
      opportunity.apply_by ??
      null,
    startDate: opportunity.start_date ?? opportunity.starts_at ?? opportunity.start_datetime ?? null,
    organization,
    organizationName:
      opportunity.organization_name ??
      opportunity.organizationName ??
      organization?.name ??
      "",
    organizationId:
      opportunity.organization_id ?? opportunity.organizationId ?? organization?.id ?? null,
    organizationWebsite:
      opportunity.organization_website ??
      opportunity.organizationWebsite ??
      organization?.website ??
      "",
    location: opportunity.location ?? opportunity.place ?? "Online",
    tags,
    bookmarked: Boolean(
      opportunity.bookmarked ??
        opportunity.saved ??
        opportunity.is_saved ??
        opportunity.isBookmarked ??
        opportunity.favorite
    ),
    applied: Boolean(opportunity.has_applied ?? opportunity.applied ?? appliedState),
    applicationStatus: appliedState,
    application:
      opportunity.application ??
      opportunity.user_application ??
      opportunity.my_application ??
      null,
    reportUrl:
      opportunity.report_url ??
      opportunity.reportUrl ??
      opportunity.report_link ??
      "",
  };
}

export function normaliseOpportunityList(source) {
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const hasCollection =
      source.opportunities != null ||
      source.items != null ||
      source.data != null ||
      source.results != null ||
      source.rows != null;

    if (!hasCollection && (source.error || source.message)) {
      return [];
    }
  }

  const items =
    source?.opportunities ??
    source?.items ??
    source?.data ??
    source?.results ??
    source?.rows ??
    source ??
    [];

  return toArray(items).map(normaliseOpportunity);
}

export function normaliseApplication(application = {}) {
  const historySource =
    application.history ??
    application.status_history ??
    application.timeline ??
    application.events ??
    [];

  return {
    ...application,
    id: application.id ?? application.application_id,
    opportunityId:
      application.opportunity_id ??
      application.opportunityId ??
      application.id ??
      null,
    opportunity: application.opportunity ? normaliseOpportunity(application.opportunity) : null,
    title: application.title ?? application.opportunity_title ?? application.opportunity_name ?? "Untitled opportunity",
    organizationName:
      application.organization_name ??
      application.organizationName ??
      application.organization?.name ??
      "",
    status: application.status ?? application.application_status ?? "pending",
    appliedAt:
      application.applied_at ??
      application.submitted_at ??
      application.created_at ??
      null,
    updatedAt:
      application.updated_at ??
      application.last_updated_at ??
      application.modified_at ??
      null,
    deadline:
      application.deadline ??
      application.application_deadline ??
      application.opportunity?.deadline ??
      null,
    history: toArray(historySource).map((entry) => ({
      ...entry,
      status: entry.status ?? entry.state ?? entry.label ?? "",
      at: entry.at ?? entry.created_at ?? entry.timestamp ?? entry.date ?? null,
      note: entry.note ?? entry.message ?? entry.reason ?? "",
    })),
  };
}

export function normaliseNotification(notification = {}) {
  return {
    ...notification,
    id: notification.id ?? notification.notification_id,
    title: notification.title ?? notification.subject ?? "Notification",
    body: notification.body ?? notification.message ?? "",
    unread: Boolean(notification.unread ?? notification.is_unread ?? notification.read_at == null),
    createdAt:
      notification.created_at ??
      notification.createdAt ??
      notification.sent_at ??
      null,
    type: notification.type ?? notification.kind ?? "update",
  };
}

export function dispatchAnalytics(eventName, payload = {}) {
  if (typeof window === "undefined") return;

  const detail = { event: eventName, ...payload };

  if (Array.isArray(window.dataLayer)) {
    window.dataLayer.push(detail);
  }

  window.dispatchEvent(new CustomEvent("analytics:event", { detail }));

  const allowedEvents = new Set([
    "opportunity_view",
    "opportunity_saved",
    "opportunity_unsaved",
    "opportunity_applied",
    "opportunity_report_clicked",
  ]);

  if (!allowedEvents.has(eventName)) {
    return;
  }

  if (!window.__oppAnalyticsQueue) {
    window.__oppAnalyticsQueue = [];
  }

  window.__oppAnalyticsQueue.push(detail);

  if (!window.__oppAnalyticsFlushTimer) {
    const flush = async () => {
      const events = window.__oppAnalyticsQueue || [];
      if (events.length === 0) return;
      window.__oppAnalyticsQueue = [];

      const payloadBody = JSON.stringify({ events });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/analytics/events", new Blob([payloadBody], { type: "application/json" }));
        return;
      }

      try {
        await fetch("/api/analytics/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: payloadBody,
          keepalive: true,
        });
      } catch {
        // Ignore analytics transport failures.
      }
    };

    window.__oppAnalyticsFlushTimer = window.setTimeout(async () => {
      window.__oppAnalyticsFlushTimer = null;
      await flush();
    }, 1000);

    const flushOnHide = () => {
      if (window.__oppAnalyticsFlushTimer) {
        clearTimeout(window.__oppAnalyticsFlushTimer);
        window.__oppAnalyticsFlushTimer = null;
      }
      flush();
    };

    window.addEventListener("pagehide", flushOnHide, { once: true });
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushOnHide();
      }
    }, { once: true });
  }
}

export function unwrapMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data === "string") return data;
  return data.error || data.message || fallback;
}

