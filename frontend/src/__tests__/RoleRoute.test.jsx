import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, test, expect, vi } from "vitest";
import RoleRoute from "../components/auth/RoleRoute";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../context/AuthContext";

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("RoleRoute", () => {
  test("renders children when user role is allowed", () => {
    useAuth.mockReturnValue({ user: { id: 1, role: "organizer" }, loading: false });

    renderWithRouter(
      <RoleRoute allowedRoles={["organizer", "admin"]}>
        <div>Organizer Content</div>
      </RoleRoute>
    );

    expect(screen.getByText("Organizer Content")).toBeInTheDocument();
  });

  test("redirects to / when user role is not allowed", () => {
    useAuth.mockReturnValue({ user: { id: 1, role: "student" }, loading: false });

    renderWithRouter(
      <RoleRoute allowedRoles={["organizer", "admin"]}>
        <div>Organizer Content</div>
      </RoleRoute>
    );

    expect(screen.queryByText("Organizer Content")).not.toBeInTheDocument();
  });

  test("redirects to /login when user is null", () => {
    useAuth.mockReturnValue({ user: null, loading: false });

    renderWithRouter(
      <RoleRoute allowedRoles={["admin"]}>
        <div>Admin Content</div>
      </RoleRoute>
    );

    expect(screen.queryByText("Admin Content")).not.toBeInTheDocument();
  });

  test("renders nothing while loading", () => {
    useAuth.mockReturnValue({ user: null, loading: true });

    renderWithRouter(
      <RoleRoute allowedRoles={["admin"]}>
        <div>Admin Content</div>
      </RoleRoute>
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading session");
  });
});
