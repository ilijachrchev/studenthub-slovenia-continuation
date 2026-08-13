import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import Discovery from "../pages/opportunities/Discovery";

function response(body, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

describe("Opportunity discovery", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  test("shows a retryable error when the initial load fails", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(response({ error: "Discovery unavailable" }, false))
      .mockResolvedValueOnce(response({ ids: [] }))
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({
        opportunities: [
          {
            id: 11,
            title: "Design Sprint",
            description: "A collaborative workshop for students.",
            location: "Campus Center",
            deadline: "2026-08-20T10:00:00Z",
            organization_name: "Innovation Lab",
          },
        ],
      }))
      .mockResolvedValueOnce(response({ ids: [11] }))
      .mockResolvedValueOnce(response({ items: [] }));

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Discovery />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Discovery unavailable");

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Design Sprint")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Discovery unavailable")).not.toBeInTheDocument();
    });
  });
});
