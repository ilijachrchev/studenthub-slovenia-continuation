import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import Notifications from "../pages/notifications/Notifications";
import ModerationQueue from "../pages/admin/moderation/ModerationQueue";
import OpportunityAnalytics from "../pages/organizer/analytics/OpportunityAnalytics";

vi.mock("../components/layout/AdminLayout", () => ({
  default: ({ children }) => <>{children}</>,
}));

vi.mock("../components/layout/OrganizerLayout", () => ({
  default: ({ children }) => <>{children}</>,
}));

vi.mock("../components/admin/moderation/ReportCard", () => ({
  default: ({ report, onOpen, active }) => (
    <button type="button" onClick={() => onOpen(report)} data-active={active}>
      {report.title}
    </button>
  ),
}));

vi.mock("../components/admin/moderation/ReportDetail", () => ({
  default: ({ report, onResolve, onDismiss, onSelectOpportunity }) =>
    report ? (
      <div>
        <h2>{report.title}</h2>
        <button type="button" onClick={() => onResolve(report)}>
          Resolve
        </button>
        <button type="button" onClick={() => onDismiss(report)}>
          Dismiss
        </button>
        <button type="button" onClick={() => onSelectOpportunity(report.opportunity_id)}>
          Open analytics
        </button>
      </div>
    ) : (
      <div>No report selected</div>
    ),
}));

vi.mock("../components/shared/StatusBadge", () => ({
  default: ({ status, label }) => <span>{label || status}</span>,
}));

function response(body, { ok = true, status = 200 } = {}) {
  return Promise.resolve({
    ok,
    status,
    json: async () => body,
  });
}

describe("notification, moderation, and analytics pages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("Notifications shows empty state and supports mark-all-read and preference toggle", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((url, options = {}) => {
      const target = String(url);
      if (target.endsWith("/api/notifications")) {
        return response({
          notifications: [
            {
              id: 1,
              title: "Application received",
              body: "Your application was received.",
              type: "application.received",
              is_read: false,
              created_at: "2026-08-01T10:00:00.000Z",
            },
          ],
          unread_count: 1,
          total: 1,
        });
      }
      if (target.endsWith("/api/notifications/preferences") && options.method !== "PUT") {
        return response({ preferences: { "application.received": true, "application.status_changed": true } });
      }
      if (target.endsWith("/api/notifications/read-all")) {
        return response({ message: "Notifications marked as read", count: 1 });
      }
      if (target.endsWith("/api/notifications/1/read")) {
        return response({ notification: { id: 1, is_read: true } });
      }
      if (target.endsWith("/api/notifications/preferences") && options.method === "PUT") {
        return response({
          preferences: { "application.received": false, "application.status_changed": true },
        });
      }
      return response({});
    });

    render(<Notifications />);

    expect(await screen.findByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("1 unread notification")).toBeInTheDocument();
    expect(screen.getByText("Application received")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /mark all read/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/notifications/read-all", expect.any(Object)));

    await user.click(screen.getByRole("button", { name: /application updates/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/notifications/preferences", expect.any(Object)));
  });

  test("Notifications shows an error when the list fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const target = String(url);
      if (target.endsWith("/api/notifications")) {
        return response({ error: "Unable to load" }, { ok: false, status: 500 });
      }
      return response({ preferences: {} });
    });

    render(<Notifications />);
    expect(await screen.findByText("Unable to load")).toBeInTheDocument();
  });

  test("ModerationQueue renders the empty state and surfaces errors", async () => {
    const emptyFetch = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const target = String(url);
      if (target.includes("/api/admin/moderation/reports?status=open")) {
        return response({ reports: [] });
      }
      return response({});
    });

    render(<ModerationQueue />);
    expect(await screen.findByText("Moderation queue")).toBeInTheDocument();
    expect(screen.getByText("No reports match this filter.")).toBeInTheDocument();
    expect(emptyFetch).toHaveBeenCalled();

    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => response({ error: "Queue down" }, { ok: false, status: 500 }));
    render(<ModerationQueue />);
    expect(await screen.findByText("Queue down")).toBeInTheDocument();
  });

  test("OpportunityAnalytics renders summary data and loading/error states", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const target = String(url);
      if (target.includes("/api/organizer/opportunities/42/analytics")) {
        return response({
          opportunity: { title: "Summer Research", status: "published", description: "Hands-on work" },
          summary: { views: 12, visits: 8, applications: 4, reviews: 2, accepts: 1, rejects: 1, conversion: 0.25 },
          funnel: [
            { stage: "Views", count: 12 },
            { stage: "Applications", count: 4 },
          ],
          timeseries: [
            { date: "2026-08-01", count: 3 },
            { date: "2026-08-02", count: 1 },
          ],
        });
      }
      return response({});
    });

    render(
      <MemoryRouter initialEntries={["/organizer/opportunities/42/analytics"]}>
        <Routes>
          <Route path="/organizer/opportunities/:id/analytics" element={<OpportunityAnalytics />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Opportunity analytics")).toBeInTheDocument();
    expect(screen.getByText("Summer Research")).toBeInTheDocument();
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
    expect(screen.getByText("25%")).toBeInTheDocument();

    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => response({ error: "Analytics unavailable" }, { ok: false, status: 500 }));

    render(
      <MemoryRouter initialEntries={["/organizer/opportunities/42/analytics"]}>
        <Routes>
          <Route path="/organizer/opportunities/:id/analytics" element={<OpportunityAnalytics />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Analytics unavailable")).toBeInTheDocument();
  });
});
