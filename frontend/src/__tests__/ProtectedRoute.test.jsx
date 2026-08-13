import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, test, expect, vi } from "vitest";
import ProtectedRoute from "../components/auth/ProtectedRoute";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../context/AuthContext";

function renderWithRoutes(ui, initialPath = "/protected") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/protected" element={ui} />
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  test("renders children when user is logged in", () => {
    useAuth.mockReturnValue({ user: { id: 1, role: "student" }, loading: false, sessionExpired: false });

    renderWithRoutes(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  test("redirects to /login when user is null", () => {
    useAuth.mockReturnValue({ user: null, loading: false, sessionExpired: false });

    renderWithRoutes(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  test("renders loading fallback while loading", () => {
    useAuth.mockReturnValue({ user: null, loading: true, sessionExpired: false });

    renderWithRoutes(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Checking session...");
  });
});
