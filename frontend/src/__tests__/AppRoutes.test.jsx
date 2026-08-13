import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";

const mockUseAuth = vi.hoisted(() => vi.fn());

vi.mock("../context/AuthContext", () => ({
  AuthProvider: ({ children }) => <>{children}</>,
  useAuth: mockUseAuth,
}));

vi.mock("../components/layout/StudentLayout", () => ({
  default: ({ children }) => <>{children}</>,
}));

vi.mock("../components/layout/OrganizerLayout", () => ({
  default: ({ children }) => <>{children}</>,
}));

vi.mock("../components/layout/AdminLayout", () => ({
  default: ({ children }) => <>{children}</>,
}));

vi.mock("../pages/Home", () => ({
  default: () => <div>Home route</div>,
}));

vi.mock("../pages/Login", () => ({
  default: () => <div>Login route</div>,
}));

vi.mock("../pages/opportunities/Discovery", () => ({
  default: () => <div>Discovery route</div>,
}));

vi.mock("../pages/opportunities/MyApplications", () => ({
  default: () => <div>My applications route</div>,
}));

vi.mock("../pages/opportunities/SavedOpportunities", () => ({
  default: () => <div>Saved opportunities route</div>,
}));

vi.mock("../pages/notifications/Notifications", () => ({
  default: () => <div>Notifications route</div>,
}));

vi.mock("../pages/admin/moderation/ModerationQueue", () => ({
  default: () => <div>Moderation route</div>,
}));

vi.mock("../pages/organizer/analytics/OpportunityAnalytics", () => ({
  default: () => <div>Analytics route</div>,
}));

vi.mock("../pages/organizer/opps/ManageOpportunities", () => ({
  default: () => <div>Manage opportunities route</div>,
}));

vi.mock("../pages/organizer/opps/OpportunityApplicants", () => ({
  default: () => <div>Applicants route</div>,
}));

vi.mock("../pages/organizer/OrganizerDashboard", () => ({
  default: () => <div>Organizer dashboard route</div>,
}));

vi.mock("../pages/organizer/CreateEvent", () => ({
  default: () => <div>Create event route</div>,
}));

import App from "../App";

function renderAt(path) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

describe("App routes", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  test("renders the discovery route", async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });

    renderAt("/opportunities");

    expect(await screen.findByText("Discovery route")).toBeInTheDocument();
  });

  test("renders protected notifications route for authenticated users", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, role: "student" }, loading: false });

    renderAt("/notifications");

    expect(await screen.findByText("Notifications route")).toBeInTheDocument();
  });

  test("redirects protected opportunities applications route to login when anonymous", async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });

    renderAt("/opportunities/applications");

    expect(await screen.findByText("Login route")).toBeInTheDocument();
  });

  test("redirects admin-only moderation route for non-admin users", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 2, role: "student" }, loading: false });

    renderAt("/admin/moderation");

    expect(screen.getByText("Home route")).toBeInTheDocument();
  });

  test("renders organizer analytics route for organizers", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 3, role: "organizer" }, loading: false });

    renderAt("/organizer/opportunities/analytics");

    expect(await screen.findByText("Analytics route")).toBeInTheDocument();
  });
});
