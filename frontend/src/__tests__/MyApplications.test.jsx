import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import MyApplications from "../pages/opportunities/MyApplications";

function response(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe("My applications", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("restores the application after a withdrawal failure", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        response({
          applications: [
            {
              id: 21,
              status: "pending",
              title: "Design Sprint",
              organization_name: "Innovation Lab",
              opportunity_id: 10,
              created_at: "2026-08-12T10:00:00Z",
              opportunity_deadline: "2026-08-20T10:00:00Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ error: "Withdraw failed" }, false, 500));

    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MemoryRouter>
        <MyApplications />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Design Sprint")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Withdraw" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Withdraw failed");
    expect(screen.getByText("Design Sprint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
  });
});
