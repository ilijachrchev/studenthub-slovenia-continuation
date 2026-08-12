import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, test, expect, vi } from "vitest";
import ProtectedRoute from "../components/auth/ProtectedRoute";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../context/AuthContext";

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("ProtectedRoute", () => {
  test("renders children when user is logged in", () => {
    useAuth.mockReturnValue({ user: { id: 1, role: "student" }, loading: false });

    renderWithRouter(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  test("redirects to /login when user is null", () => {
    useAuth.mockReturnValue({ user: null, loading: false });

    renderWithRouter(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  test("renders nothing while loading", () => {
    useAuth.mockReturnValue({ user: null, loading: true });

    renderWithRouter(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading session");
  });
});
