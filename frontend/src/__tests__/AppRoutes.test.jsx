import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, test, expect, vi } from "vitest";
import AppRoutes from "../AppRoutes";

vi.mock("../components/auth/ProtectedRoute", () => ({
  default: ({ children }) => <>{children}</>,
}));

vi.mock("../components/auth/RoleRoute", () => ({
  default: ({ children }) => <>{children}</>,
}));

vi.mock("../components/layout/StudentLayout", () => ({
  default: ({ children }) => <div data-testid="student-layout">{children}</div>,
}));

vi.mock("../components/layout/OrganizerLayout", () => ({
  default: ({ children }) => <div data-testid="organizer-layout">{children}</div>,
}));

vi.mock("../components/layout/AdminLayout", () => ({
  default: ({ children }) => <div data-testid="admin-layout">{children}</div>,
}));

vi.mock("../pages/Home", () => ({ default: () => <div>Home Page</div> }));
vi.mock("../pages/opportunities/Discovery", () => ({ default: () => <div>Opportunity Discovery</div> }));
vi.mock("../pages/admin/moderation/ModerationQueue", () => ({ default: () => <div>Moderation Queue</div> }));
vi.mock("../pages/notifications/Notifications", () => ({ default: () => <div>Notifications Page</div> }));
vi.mock("../pages/opportunities/SavedOpportunities", () => ({ default: () => <div>Saved Opportunities Page</div> }));
vi.mock("../pages/opportunities/MyApplications", () => ({ default: () => <div>My Applications Page</div> }));
vi.mock("../pages/organizer/opps/ManageOpportunities", () => ({ default: () => <div>Manage Opportunities Page</div> }));
vi.mock("../pages/organizer/opps/OpportunityApplicants", () => ({ default: () => <div>Opportunity Applicants Page</div> }));
vi.mock("../pages/organizer/analytics/OpportunityAnalytics", () => ({ default: () => <div>Opportunity Analytics Page</div> }));
vi.mock("../pages/admin/PendingEvents", () => ({ default: () => <div>Pending Events Page</div> }));
vi.mock("../pages/admin/PendingOrganizations", () => ({ default: () => <div>Pending Organizations Page</div> }));
vi.mock("../pages/Saved", () => ({ default: () => <div>Saved Events Page</div> }));
vi.mock("../pages/MyRegistrations", () => ({ default: () => <div>My Registrations Page</div> }));
vi.mock("../pages/AccountSettings", () => ({ default: () => <div>Account Settings Page</div> }));
vi.mock("../pages/Login", () => ({ default: () => <div>Login Page</div> }));
vi.mock("../pages/Register", () => ({ default: () => <div>Register Page</div> }));
vi.mock("../pages/ResetPassword", () => ({ default: () => <div>Reset Password Page</div> }));
vi.mock("../pages/SetupFeed", () => ({ default: () => <div>Setup Feed Page</div> }));
vi.mock("../pages/SetupOrganization", () => ({ default: () => <div>Setup Organization Page</div> }));
vi.mock("../pages/ApplicationStatus", () => ({ default: () => <div>Application Status Page</div> }));
vi.mock("../pages/EventDetail", () => ({ default: () => <div>Event Detail Page</div> }));
vi.mock("../pages/OrganizationProfile", () => ({ default: () => <div>Organization Profile Page</div> }));
vi.mock("../pages/SearchResults", () => ({ default: () => <div>Search Results Page</div> }));
vi.mock("../pages/Feedback", () => ({ default: () => <div>Feedback Page</div> }));
vi.mock("../pages/organizer/OrganizerDashboard", () => ({ default: () => <div>Organizer Dashboard Page</div> }));
vi.mock("../pages/organizer/CreateEvent", () => ({ default: () => <div>Create Event Page</div> }));

describe("AppRoutes", () => {
  test("renders the opportunity hub discovery route", () => {
    render(
      <MemoryRouter initialEntries={["/opportunities"]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByText("Opportunity Discovery")).toBeInTheDocument();
    expect(screen.getByTestId("student-layout")).toBeInTheDocument();
  });

  test("renders the moderation route", () => {
    render(
      <MemoryRouter initialEntries={["/admin/moderation"]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByText("Moderation Queue")).toBeInTheDocument();
  });

  test("keeps the legacy saved route", () => {
    render(
      <MemoryRouter initialEntries={["/saved"]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByText("Saved Events Page")).toBeInTheDocument();
  });
});
