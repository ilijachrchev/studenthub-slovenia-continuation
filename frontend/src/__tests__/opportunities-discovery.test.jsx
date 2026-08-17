import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, beforeEach, afterEach, test, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Discovery from "../pages/opportunities/Discovery";

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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Opportunity discovery", () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ user: { id: 1, role: "student" }, loading: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("loads opportunities and reapplies filters with explicit empty state", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: 1,
              title: "Open Source Sprint",
              description: "Build real software with local mentors.",
              location: "Koper",
              status: "published",
              deadline: "2026-09-30T12:00:00.000Z",
              organization_id: 1,
              organization_name: "Open Source Club",
            },
            {
              id: 2,
              title: "AI Research Assistants",
              description: "Support a small lab on applied ML work.",
              location: "Ljubljana",
              status: "published",
              deadline: "2026-10-15T12:00:00.000Z",
              organization_id: 2,
              organization_name: "AI Research Group",
            },
          ],
          total: 2,
          hasMore: false,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ids: [1] }))
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0, hasMore: false }))
      .mockResolvedValueOnce(jsonResponse({ ids: [] }));

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Discovery />
      </MemoryRouter>
    );

    expect(await screen.findByText("Open Source Sprint")).toBeInTheDocument();
    expect(screen.getByText("AI Research Assistants")).toBeInTheDocument();

    const availability = screen.getByLabelText("Availability");
    await user.selectOptions(availability, "closed");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("No opportunities found");
    });

    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("availability=closed"))
    ).toBe(true);
  });

  test("prevents duplicate save requests while a bookmark mutation is pending", async () => {
    const bookmarkDeferred = createDeferred();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: 7,
              title: "Data Science Internship",
              description: "Work with a student data team.",
              location: "Maribor",
              status: "published",
              deadline: "2026-11-01T12:00:00.000Z",
              organization_id: 3,
              organization_name: "Data Lab",
            },
          ],
          total: 1,
          hasMore: false,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ids: [] }))
      .mockImplementationOnce(() => bookmarkDeferred.promise);

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Discovery />
      </MemoryRouter>
    );

    const saveButton = await screen.findByRole("button", { name: /save opportunity/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(saveButton).toBeDisabled();
    });

    fireEvent.click(saveButton);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/bookmark")).length).toBe(1);

    bookmarkDeferred.resolve(jsonResponse({ message: "Opportunity saved" }));
    await waitFor(() => {
      expect(screen.getByText("Opportunity saved.")).toBeInTheDocument();
    });
  });
});
