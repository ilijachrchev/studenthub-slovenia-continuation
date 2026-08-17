import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, beforeEach, afterEach, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import OpportunityDetail from "../pages/opportunities/OpportunityDetail";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../context/AuthContext";

function jsonResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
  };
}

describe("Opportunity detail", () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ user: { id: 1, role: "student" }, loading: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("submits an application and refreshes the status view", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          opportunity: {
            id: 11,
            title: "Community Coding Fellowship",
            description: "Build community software with mentors.",
            location: "Koper",
            status: "published",
            deadline: "2026-10-20T12:00:00.000Z",
            published_at: "2026-08-01T12:00:00.000Z",
            organization_id: 1,
            organization_name: "Open Source Club",
            organization_website: "https://example.org",
            bookmarked: false,
            applicationStatus: "",
            application: null,
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ message: "Opportunity saved" }))
      .mockResolvedValueOnce(jsonResponse({ message: "Application submitted", status: "pending" }))
      .mockResolvedValueOnce(
        jsonResponse({
          opportunity: {
            id: 11,
            title: "Community Coding Fellowship",
            description: "Build community software with mentors.",
            location: "Koper",
            status: "published",
            deadline: "2026-10-20T12:00:00.000Z",
            published_at: "2026-08-01T12:00:00.000Z",
            organization_id: 1,
            organization_name: "Open Source Club",
            organization_website: "https://example.org",
            bookmarked: true,
            applicationStatus: "pending",
            application: {
              id: 55,
              status: "pending",
              history: [
                {
                  id: 1,
                  action: "application_created",
                  from_status: null,
                  to_status: "pending",
                  actor_user_id: 1,
                  created_at: "2026-08-17T10:00:00.000Z",
                },
              ],
            },
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }));

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/opportunities/11"]}>
        <Routes>
          <Route path="/opportunities/:id" element={<OpportunityDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Community Coding Fellowship")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^saved$/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Cover note"), "I can help with the front end.");
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    await waitFor(() => {
      expect(screen.getByText("You have already applied for this opportunity.")).toBeInTheDocument();
    });

    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/bookmark") && init?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/apply") && init?.method === "POST")).toBe(true);
  });

  test("shows the applied state and history instead of a duplicate submit form", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          opportunity: {
            id: 12,
            title: "Robotics Sprint",
            description: "An applied project for embedded systems.",
            location: "Ljubljana",
            status: "published",
            deadline: "2026-10-20T12:00:00.000Z",
            published_at: "2026-08-01T12:00:00.000Z",
            organization_id: 2,
            organization_name: "AI Research Group",
            bookmarked: true,
            applicationStatus: "under_review",
            application: {
              id: 60,
              status: "under_review",
              history: [
                {
                  id: 2,
                  action: "status_transition",
                  from_status: "pending",
                  to_status: "under_review",
                  actor_user_id: 2,
                  created_at: "2026-08-16T10:00:00.000Z",
                },
              ],
            },
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }));

    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/opportunities/12"]}>
        <Routes>
          <Route path="/opportunities/:id" element={<OpportunityDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Robotics Sprint")).toBeInTheDocument();
    expect(screen.getByText("You have already applied for this opportunity.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^apply$/i })).not.toBeInTheDocument();
    expect(screen.getByText("Application history")).toBeInTheDocument();
  });
});
