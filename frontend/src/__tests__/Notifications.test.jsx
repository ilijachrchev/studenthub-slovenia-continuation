import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import Notifications from "../pages/notifications/Notifications";
import { NotificationsProvider } from "../context/NotificationsContext";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../context/AuthContext";

function renderNotifications() {
  return render(
    <MemoryRouter>
      <NotificationsProvider>
        <Notifications />
      </NotificationsProvider>
    </MemoryRouter>
  );
}

function notificationResponse(items) {
  return {
    ok: true,
    json: async () => ({ items, unread_count: items.filter((item) => item.is_read === false).length }),
  };
}

function preferencesResponse(preferences = {}) {
  return {
    ok: true,
    json: async () => ({ preferences }),
  };
}

describe("Notifications", () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ user: { id: 1, role: "student" }, loading: false });
    global.fetch = vi.fn();
  });

  test("loads notifications and updates unread state when a notification is marked read", async () => {
    const initialItems = [
      {
        id: 1,
        title: "Application approved",
        body: "Your application moved forward.",
        is_read: false,
        created_at: "2026-08-01T10:00:00Z",
        type: "application.status_changed",
      },
    ];

    global.fetch
      .mockResolvedValueOnce(notificationResponse(initialItems))
      .mockResolvedValueOnce(preferencesResponse({
        application_updates: true,
        recommendation_updates: true,
        deadline_reminders: true,
      }))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notification: { ...initialItems[0], is_read: true } }),
      });

    const user = userEvent.setup();
    renderNotifications();

    expect(await screen.findByText("Application approved")).toBeInTheDocument();
    expect(screen.getByText("1 unread notification")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark read" }));

    await waitFor(() => {
      expect(screen.getByText("0 unread notifications")).toBeInTheDocument();
    });
    expect(screen.queryByText("Unread")).not.toBeInTheDocument();
  });

  test("rolls back mark-read failures and surfaces the server error", async () => {
    const initialItems = [
      {
        id: 2,
        title: "Deadline reminder",
        body: "A deadline is approaching.",
        is_read: false,
        created_at: "2026-08-01T10:00:00Z",
        type: "deadline_reminders",
      },
    ];

    global.fetch
      .mockResolvedValueOnce(notificationResponse(initialItems))
      .mockResolvedValueOnce(preferencesResponse())
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Could not update notification" }),
      });

    const user = userEvent.setup();
    renderNotifications();

    expect(await screen.findByText("Deadline reminder")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark read" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not update notification");
    expect(screen.getByText("1 unread notification")).toBeInTheDocument();
    expect(screen.getByText("Unread")).toBeInTheDocument();
  });

  test("refreshes unread counts when the window regains focus", async () => {
    const initialItems = [
      {
        id: 3,
        title: "Initial",
        body: "First load.",
        is_read: false,
        created_at: "2026-08-01T10:00:00Z",
        type: "application.status_changed",
      },
    ];
    const refreshedItems = [
      {
        id: 3,
        title: "Initial",
        body: "First load.",
        is_read: true,
        created_at: "2026-08-01T10:00:00Z",
        type: "application.status_changed",
      },
    ];

    global.fetch
      .mockResolvedValueOnce(notificationResponse(initialItems))
      .mockResolvedValueOnce(preferencesResponse())
      .mockResolvedValueOnce(notificationResponse(refreshedItems))
      .mockResolvedValueOnce(preferencesResponse());

    renderNotifications();

    expect(await screen.findByText("Initial")).toBeInTheDocument();
    expect(screen.getByText("1 unread notification")).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(screen.getByText("0 unread notifications")).toBeInTheDocument();
    });
  });
});
