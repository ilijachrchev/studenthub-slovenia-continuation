import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, afterEach, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import MyApplications from "../pages/opportunities/MyApplications";

function jsonResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
  };
}

describe("My applications", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("shows history and withdraws through the application API", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          applications: [
            {
              id: 90,
              status: "pending",
              applied_at: "2026-08-10T10:00:00.000Z",
              deadline: "2026-09-10T10:00:00.000Z",
              title: "Campus Web Project",
              organization_name: "Open Source Club",
              opportunity_id: 31,
              opportunity: {
                id: 31,
                title: "Campus Web Project",
                description: "A student-built platform for campus services.",
                deadline: "2026-09-10T10:00:00.000Z",
              },
              history: [
                {
                  id: 1,
                  action: "application_created",
                  to_status: "pending",
                  created_at: "2026-08-10T10:00:00.000Z",
                },
              ],
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ message: "Application withdrawn" }))
      .mockResolvedValueOnce(
        jsonResponse({
          applications: [
            {
              id: 90,
              status: "withdrawn",
              applied_at: "2026-08-10T10:00:00.000Z",
              deadline: "2026-09-10T10:00:00.000Z",
              title: "Campus Web Project",
              organization_name: "Open Source Club",
              opportunity_id: 31,
              opportunity: {
                id: 31,
                title: "Campus Web Project",
                description: "A student-built platform for campus services.",
                deadline: "2026-09-10T10:00:00.000Z",
              },
              history: [
                {
                  id: 1,
                  action: "application_created",
                  to_status: "pending",
                  created_at: "2026-08-10T10:00:00.000Z",
                },
                {
                  id: 2,
                  action: "status_transition",
                  from_status: "pending",
                  to_status: "withdrawn",
                  created_at: "2026-08-17T10:00:00.000Z",
                },
              ],
            },
          ],
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/opportunities/applications"]}>
        <Routes>
          <Route path="/opportunities/applications" element={<MyApplications />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Campus Web Project")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^withdraw$/i }));
    await waitFor(() => {
      expect(screen.getByText("Application withdrawn")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^withdraw$/i })).not.toBeInTheDocument();
    });

    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/apply") && init?.method === "DELETE")).toBe(true);
    expect(confirmSpy).toHaveBeenCalled();
  });
});
