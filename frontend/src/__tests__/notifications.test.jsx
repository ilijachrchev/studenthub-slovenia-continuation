import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, afterEach, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Notifications from "../pages/notifications/Notifications";

function jsonResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
  };
}

describe("Notifications", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("marks notifications as read and keeps unread state in sync", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          notifications: [
            {
              id: 1,
              type: "application.received",
              unread: true,
              created_at: "2026-08-17T09:00:00.000Z",
              payload: {
                opportunityId: 41,
                opportunityTitle: "Open Source Sprint",
                applicantName: "Student One",
              },
            },
            {
              id: 2,
              type: "application.status_changed",
              unread: false,
              created_at: "2026-08-16T09:00:00.000Z",
              payload: {
                opportunityId: 42,
                opportunityTitle: "Data Lab Placement",
                fromStatus: "pending",
                toStatus: "under_review",
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ preferences: { "application.received": true, "application.status_changed": true } }))
      .mockResolvedValueOnce(jsonResponse({ notification: { id: 1, unread: false } }))
      .mockResolvedValueOnce(jsonResponse({ message: "Notifications marked as read", count: 1 }));

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/notifications"]}>
        <Routes>
          <Route path="/notifications" element={<Notifications />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("1 unread notification")).toBeInTheDocument();
    expect(screen.getByText("Student One applied for Open Source Sprint.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^mark read$/i }));
    await waitFor(() => {
      expect(screen.getByText("0 unread notifications")).toBeInTheDocument();
    });

    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/notifications/1/read") && init?.method === "POST")).toBe(true);
  });

  test("persists notification preference toggles", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ notifications: [] }))
      .mockResolvedValueOnce(jsonResponse({ preferences: { "application.received": true, "application.status_changed": true, recommendation_updates: true, deadline_reminders: true } }))
      .mockResolvedValueOnce(jsonResponse({ preferences: { "application.received": false, "application.status_changed": true, recommendation_updates: true, deadline_reminders: true } }));

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/notifications"]}>
        <Routes>
          <Route path="/notifications" element={<Notifications />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("No notifications")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^application updates$/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url, init]) => String(url).includes("/notifications/preferences") && init?.method === "PUT")
      ).toBe(true);
    });
  });
});
