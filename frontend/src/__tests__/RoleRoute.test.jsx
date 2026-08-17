import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, test, expect, vi } from "vitest";
import RoleRoute from "../components/auth/RoleRoute";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../context/AuthContext";

function renderWithRouter(ui) {
  return render(
    <MemoryRouter initialEntries={["/organizer"]}>
      <Routes>
        <Route path="/organizer" element={ui} />
        <Route path="/login" element={<LocationProbe />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
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
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });

  test("redirects to /login when user is null", () => {
    useAuth.mockReturnValue({ user: null, loading: false });

    renderWithRouter(
      <RoleRoute allowedRoles={["admin"]}>
        <div>Admin Content</div>
      </RoleRoute>
    );

    expect(screen.queryByText("Admin Content")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/login?next=%2Forganizer"
    );
  });

  test("renders nothing while loading", () => {
    useAuth.mockReturnValue({ user: null, loading: true });

    renderWithRouter(
      <RoleRoute allowedRoles={["admin"]}>
        <div>Admin Content</div>
      </RoleRoute>
    );

    expect(screen.getByRole("status")).toHaveTextContent("Checking permissions");
  });
});
