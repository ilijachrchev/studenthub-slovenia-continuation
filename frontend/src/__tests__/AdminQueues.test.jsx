import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, beforeEach, test, vi } from "vitest";
import PendingEvents from "../pages/admin/PendingEvents";
import PendingOrganizations from "../pages/admin/PendingOrganizations";

function mockJsonResponse(body, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

describe("Admin queues", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  test("pending events retry after an initial load failure", async () => {
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ error: "Queue unavailable" }, false))
      .mockResolvedValueOnce(mockJsonResponse({
        events: [
          {
            id: 1,
            title: "Hack Night",
            organizer_name: "Student Union",
            start_datetime: "2026-08-15T18:00:00Z",
            end_datetime: "2026-08-15T20:00:00Z",
            location: "Main Hall",
            registration_type: "Open",
            description: "A short showcase event.",
          },
        ],
      }));

    const user = userEvent.setup();
    render(<PendingEvents />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Queue unavailable");

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Hack Night")).toBeInTheDocument();
    expect(screen.queryByText("Queue unavailable")).not.toBeInTheDocument();
  });

  test("pending organizations retry after an initial load failure", async () => {
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({ error: "Queue unavailable" }, false))
      .mockResolvedValueOnce(mockJsonResponse({
        organizations: [
          {
            id: 2,
            name: "Robotics Club",
            first_name: "Ava",
            last_name: "Stone",
            applicant_email: "ava@example.com",
            contact_email: "contact@example.com",
            website: "https://example.com",
            description: "A student organization for robotics.",
          },
        ],
      }));

    const user = userEvent.setup();
    render(<PendingOrganizations />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Queue unavailable");

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Robotics Club")).toBeInTheDocument();
    expect(screen.queryByText("Queue unavailable")).not.toBeInTheDocument();
  });

  test("reject modal is exposed as a dialog", async () => {
    global.fetch
      .mockResolvedValueOnce(mockJsonResponse({
        events: [
          {
            id: 3,
            title: "Spring Fair",
            organizer_name: "Campus Life",
            start_datetime: "2026-08-16T10:00:00Z",
            end_datetime: "2026-08-16T12:00:00Z",
            location: "Quad",
            registration_type: "Open",
          },
        ],
      }))
      .mockResolvedValueOnce(mockJsonResponse({ message: "Rejected" }));

    const user = userEvent.setup();
    render(<PendingEvents />);

    await screen.findByText("Spring Fair");
    await user.click(screen.getByRole("button", { name: "Reject" }));

    const dialog = await screen.findByRole("dialog", { name: 'Reject "Spring Fair"' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject Event" })).toBeDisabled();
  });
});
