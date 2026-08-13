import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import OpportunityDetail from "../pages/opportunities/OpportunityDetail";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../context/AuthContext";

function response(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/opportunities/10"]}>
      <Routes>
        <Route path="/opportunities/:id" element={<OpportunityDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Opportunity detail", () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ user: { id: 1, role: "student" }, loading: false });
    globalThis.fetch = vi.fn();
  });

  test("keeps the detail visible when related data fails to load", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        response({
          opportunity: {
            id: 10,
            title: "Design Sprint",
            description: "A focused week of product design work.",
            location: "Design Studio",
            deadline: "2026-08-20T10:00:00Z",
            organization_name: "Innovation Lab",
          },
        }),
      )
      .mockResolvedValueOnce(response({ error: "Related opportunities offline" }, false, 503))
      .mockResolvedValueOnce(response({ ids: [] }));

    renderDetail();

    expect(await screen.findByText("Design Sprint")).toBeInTheDocument();
    expect(screen.getByText("Related opportunities offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  test("submits an application and shows inline success feedback", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        response({
          opportunity: {
            id: 10,
            title: "Design Sprint",
            description: "A focused week of product design work.",
            location: "Design Studio",
            deadline: "2026-08-20T10:00:00Z",
            organization_name: "Innovation Lab",
          },
        }),
      )
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ ids: [] }))
      .mockResolvedValueOnce(response({ message: "Application submitted", status: "submitted" }, true, 201));

    const user = userEvent.setup();
    renderDetail();

    expect(await screen.findByText("Design Sprint")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Cover note"), "I can help with the event.");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Application submitted.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("You have already applied for this opportunity.")).toBeInTheDocument();
    });
  });
});
