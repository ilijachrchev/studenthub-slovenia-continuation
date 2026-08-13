import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import SavedOpportunities from "../pages/opportunities/SavedOpportunities";

function response(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe("Saved opportunities", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  test("restores a saved opportunity when removal fails", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        response({
          opportunities: [
            {
              id: 31,
              title: "Research Assistant",
              description: "Support a research team.",
              location: "Library",
              deadline: "2026-08-25T10:00:00Z",
              organization_name: "Innovation Lab",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ error: "Remove failed" }, false, 500));

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <SavedOpportunities />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Research Assistant")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove saved opportunity" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Remove failed");
    expect(screen.getByText("Research Assistant")).toBeInTheDocument();
  });
});
