import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, test, expect, vi } from "vitest";
import RoleRoute from "../components/auth/RoleRoute";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../context/AuthContext";

function renderWithRoutes(ui, initialPath = "/admin") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/admin" element={ui} />
        <Route path="/organizer" element={<div>Organizer Home</div>} />
        <Route path="/" element={<div>Student Home</div>} />
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RoleRoute", () => {
  test("renders children when user role is allowed", () => {
    useAuth.mockReturnValue({ user: { id: 1, role: "organizer" }, loading: false, sessionExpired: false });

    renderWithRoutes(
      <RoleRoute allowedRoles={["organizer", "admin"]}>
        <div>Organizer Content</div>
      </RoleRoute>,
    );

    expect(screen.getByText("Organizer Content")).toBeInTheDocument();
  });

  test("redirects to the user's home route when role is not allowed", () => {
    useAuth.mockReturnValue({ user: { id: 1, role: "student" }, loading: false, sessionExpired: false });

    renderWithRoutes(
      <RoleRoute allowedRoles={["organizer", "admin"]}>
        <div>Organizer Content</div>
      </RoleRoute>,
    );

    expect(screen.getByText("Student Home")).toBeInTheDocument();
  });

  test("redirects to /login when user is null", () => {
    useAuth.mockReturnValue({ user: null, loading: false, sessionExpired: false });

    renderWithRoutes(
      <RoleRoute allowedRoles={["admin"]}>
        <div>Admin Content</div>
      </RoleRoute>,
    );

    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  test("renders loading fallback while loading", () => {
    useAuth.mockReturnValue({ user: null, loading: true, sessionExpired: false });

    renderWithRoutes(
      <RoleRoute allowedRoles={["admin"]}>
        <div>Admin Content</div>
      </RoleRoute>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Checking session...");
  });
});
