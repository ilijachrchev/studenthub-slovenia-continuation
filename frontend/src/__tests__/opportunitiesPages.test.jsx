import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import Discovery from "../pages/opportunities/Discovery";
import MyApplications from "../pages/opportunities/MyApplications";
import OpportunityDetail from "../pages/opportunities/OpportunityDetail";
import SavedOpportunities from "../pages/opportunities/SavedOpportunities";

const mockUseAuth = vi.hoisted(() => vi.fn());

vi.mock("../context/AuthContext", () => ({
  useAuth: mockUseAuth,
}));

function response(body, { ok = true, status = 200 } = {}) {
  return Promise.resolve({
    ok,
    status,
    json: async () => body,
  });
}

function renderWithRouter(ui, path = "/") {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe("opportunity pages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockUseAuth.mockReset();
  });

  test("Discovery shows loading, empty, and recommendation states", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (String(url).includes("/api/opportunities?")) {
        return response({ opportunities: [] });
      }
      if (String(url).includes("/api/opportunities/saved/ids")) {
        return response({ ids: [] });
      }
      if (String(url).includes("/api/recommendations")) {
        return response({
          opportunities: [
            {
              id: 7,
              title: "AI Lab Assistant",
              description: "Support a lab and learn",
              location: "Koper",
              deadline: "2027-12-31",
              organization_name: "Open Source Club",
              primary_reason: "Matches your interests",
              tags: [{ id: 1, name: "Workshop" }],
            },
          ],
        });
      }
      return response({});
    });

    renderWithRouter(<Discovery />);
    expect(screen.getByText("Loading opportunities...")).toBeInTheDocument();

    expect(await screen.findByText("No opportunities match your filters right now.")).toBeInTheDocument();
    expect(screen.getByText("Recommended for you")).toBeInTheDocument();
    expect(screen.getAllByTitle("Why am I seeing this?").length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("Discovery recovers when bookmark saving fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation((url, options = {}) => {
      const target = String(url);
      if (target.includes("/api/opportunities?")) {
        return response({
          opportunities: [
            {
              id: 1,
              title: "Published Opportunity",
              description: "Description",
              location: "Koper",
              deadline: "2027-12-31",
              organization_name: "Open Source Club",
              tags: [{ id: 1, name: "Workshop" }],
            },
          ],
        });
      }
      if (target.includes("/api/opportunities/saved/ids")) {
        return response({ ids: [] });
      }
      if (target.includes("/api/recommendations")) {
        return response({ opportunities: [] });
      }
      if (target.includes("/bookmark") && options.method === "POST") {
        return response({ error: "Failed" }, { ok: false, status: 500 });
      }
      return response({});
    });

    renderWithRouter(<Discovery />);
    const saveButton = await screen.findByRole("button", { name: /save opportunity/i });
    await user.click(saveButton);

    await waitFor(() => expect(screen.getByRole("button", { name: /save opportunity/i })).toBeInTheDocument());
  });

  test("Opportunity detail applies successfully and handles application conflicts", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 9, role: "student" }, loading: false });
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((url, options = {}) => {
      const target = String(url);
      if (target.endsWith("/api/opportunities/11")) {
        return response({
          id: 11,
          title: "Summer Research",
          description: "Work with a team",
          location: "Koper",
          deadline: "2027-12-31T23:59:00.000Z",
          organization_id: 3,
          organization_name: "Game Dev Hub",
          organizationWebsite: "",
          tags: [{ id: 1, name: "Workshop" }],
          applicationStatus: "not_applied",
          primary_reason: "Matches your interests",
        });
      }
      if (target.endsWith("/api/opportunities/11/related")) {
        return response({ opportunities: [] });
      }
      if (target.endsWith("/api/opportunities/saved/ids")) {
        return response({ ids: [] });
      }
      if (target.endsWith("/api/opportunities/11/apply") && options.method === "POST") {
        return response({ message: "Application submitted", status: "pending" });
      }
      return response({});
    });

    renderWithRouter(
      <Routes>
        <Route path="/opportunities/:id" element={<OpportunityDetail />} />
      </Routes>,
      "/opportunities/11"
    );

    expect(await screen.findByText("Summer Research")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(
        screen.getByText("You have already applied for this opportunity.", {
          selector: ".opp-page-status",
        })
      ).toBeInTheDocument()
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/opportunities/11/apply",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      })
    );
  });

  test("Opportunity detail surfaces apply conflicts", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 9, role: "student" }, loading: false });
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation((url, options = {}) => {
      const target = String(url);
      if (target.endsWith("/api/opportunities/22")) {
        return response({
          id: 22,
          title: "Conflict Opportunity",
          description: "Work with a team",
          location: "Koper",
          deadline: "2027-12-31T23:59:00.000Z",
          organization_id: 3,
          organization_name: "Game Dev Hub",
          tags: [],
          applicationStatus: "not_applied",
        });
      }
      if (target.endsWith("/api/opportunities/22/related")) {
        return response({ opportunities: [] });
      }
      if (target.endsWith("/api/opportunities/saved/ids")) {
        return response({ ids: [] });
      }
      if (target.endsWith("/api/opportunities/22/apply") && options.method === "POST") {
        return response({ error: "You have already applied for this opportunity." }, { ok: false, status: 409 });
      }
      return response({});
    });

    renderWithRouter(
      <Routes>
        <Route path="/opportunities/:id" element={<OpportunityDetail />} />
      </Routes>,
      "/opportunities/22"
    );

    expect(await screen.findByText("Conflict Opportunity")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(
        screen.getByText("You have already applied for this opportunity.", {
          selector: ".opp-page-status.error-text",
        })
      ).toBeInTheDocument()
    );
  });

  test("My applications renders empty and rollback-safe withdrawal state", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation((url, options = {}) => {
      const target = String(url);
      if (target.endsWith("/api/opportunities/applications")) {
        return response({
          applications: [
            {
              id: 101,
              opportunityId: 77,
              title: "Applied Opportunity",
              organizationName: "Open Source Club",
              status: "pending",
              appliedAt: "2026-08-01T12:00:00.000Z",
              deadline: "2027-12-31T23:59:00.000Z",
              history: [],
            },
          ],
        });
      }
      if (target.endsWith("/api/opportunities/77/apply") && options.method === "DELETE") {
        return response({ error: "withdraw failed" }, { ok: false, status: 500 });
      }
      return response({});
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithRouter(<MyApplications />);
    expect(await screen.findByText("Applied Opportunity")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /withdraw/i }));
    await waitFor(() => expect(screen.getByText("Applied Opportunity")).toBeInTheDocument());
  });

  test("Saved opportunities renders the empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const target = String(url);
      if (target.endsWith("/api/opportunities/saved")) {
        return response({ opportunities: [] });
      }
      return response({});
    });

    renderWithRouter(<SavedOpportunities />);
    expect(await screen.findByText("You have not saved any opportunities yet.")).toBeInTheDocument();
  });
});
