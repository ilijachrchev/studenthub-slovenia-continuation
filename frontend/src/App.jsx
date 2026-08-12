import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import SetupOrganization from "./pages/SetupOrganization";
import SetupFeed from "./pages/SetupFeed";
import ApplicationStatus from "./pages/ApplicationStatus";
import Home from "./pages/Home";
import EventDetail from "./pages/EventDetail";
import StudentLayout from "./components/layout/StudentLayout";
import OrganizerLayout from "./components/layout/OrganizerLayout";
import OrganizerDashboard from "./pages/organizer/OrganizerDashboard";
import CreateEvent from "./pages/organizer/CreateEvent";
import AdminLayout from "./components/layout/AdminLayout";
import PendingEvents from "./pages/admin/PendingEvents";
import PendingOrganizations from "./pages/admin/PendingOrganizations";
import AccountSettings from "./pages/AccountSettings";
import Saved from "./pages/Saved";
import Feedback from "./pages/Feedback";
import OrganizationProfile from "./pages/OrganizationProfile";
import SearchResults from "./pages/SearchResults";
import ResetPassword from "./pages/ResetPassword";
import { AuthProvider } from "./context/AuthContext";
import MyRegistrations from "./pages/MyRegistrations";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import RoleRoute from "./components/auth/RoleRoute";
import Discovery from "./pages/opportunities/Discovery";
import OpportunityDetail from "./pages/opportunities/OpportunityDetail";
import MyApplications from "./pages/opportunities/MyApplications";
import SavedOpportunities from "./pages/opportunities/SavedOpportunities";
import Notifications from "./pages/notifications/Notifications";
import ManageOpportunities from "./pages/organizer/opps/ManageOpportunities";
import OpportunityApplicants from "./pages/organizer/opps/OpportunityApplicants";
import OpportunityAnalytics from "./pages/organizer/analytics/OpportunityAnalytics";
import ModerationQueue from "./pages/admin/moderation/ModerationQueue";


export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={
            <StudentLayout>
              <Home />
            </StudentLayout>
          } />
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/register" element={<Register />} />
          <Route path="/setup-organization" element={
            <RoleRoute allowedRoles={["organizer"]}>
              <SetupOrganization />
            </RoleRoute>
          } />
          <Route path="/setup-feed" element={
            <ProtectedRoute>
              <SetupFeed />
            </ProtectedRoute>
          } />
          <Route path="/application-status" element={
            <RoleRoute allowedRoles={["organizer"]}>
              <ApplicationStatus />
            </RoleRoute>
          } />
          <Route path="/events/:id" element={
            <StudentLayout>
              <EventDetail />
            </StudentLayout>  
          } />
          <Route path="/organizations/:id" element={
            <StudentLayout>
              <OrganizationProfile />
            </StudentLayout>  
          } />
          <Route path="/my-registrations" element={
            <ProtectedRoute>
              <StudentLayout>
                <MyRegistrations />
              </StudentLayout>
            </ProtectedRoute>
          } />
          <Route path="/organizer" element={
            <RoleRoute allowedRoles={["organizer"]}>
              <OrganizerLayout>
                <OrganizerDashboard />
              </OrganizerLayout>
            </RoleRoute>
          } />
          <Route path="/organizer/events/new" element={
            <RoleRoute allowedRoles={["organizer"]}>
              <OrganizerLayout>
                <CreateEvent />
              </OrganizerLayout>
            </RoleRoute>
          } />
          <Route path="/admin" element={
            <RoleRoute allowedRoles={["admin"]}>
              <AdminLayout>
                <PendingEvents />
              </AdminLayout>
            </RoleRoute>
          } />
          <Route path="/admin/organizations" element={
            <RoleRoute allowedRoles={["admin"]}>
              <AdminLayout>
                <PendingOrganizations />
              </AdminLayout>
            </RoleRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute>
              <StudentLayout>
                <AccountSettings />
              </StudentLayout>
            </ProtectedRoute>
          } />
          <Route path="/saved" element={
            <ProtectedRoute>
              <StudentLayout>
                <Saved />
              </StudentLayout>
            </ProtectedRoute>
          } />
          <Route path="/events/:eventId/feedback" element={
            <ProtectedRoute>
              <StudentLayout>
                <Feedback />
              </StudentLayout>
            </ProtectedRoute>
          } />
          <Route path="/search" element={
            <StudentLayout>
              <SearchResults />
            </StudentLayout>
          } />
          <Route path="/opportunities" element={
            <RoleRoute allowedRoles={["student"]}>
              <StudentLayout><Discovery /></StudentLayout>
            </RoleRoute>
          } />
          <Route path="/opportunities/:id" element={
            <RoleRoute allowedRoles={["student"]}>
              <StudentLayout><OpportunityDetail /></StudentLayout>
            </RoleRoute>
          } />
          <Route path="/applications/mine" element={
            <RoleRoute allowedRoles={["student"]}>
              <StudentLayout><MyApplications /></StudentLayout>
            </RoleRoute>
          } />
          <Route path="/saved-opportunities" element={
            <RoleRoute allowedRoles={["student"]}>
              <StudentLayout><SavedOpportunities /></StudentLayout>
            </RoleRoute>
          } />
          <Route path="/notifications" element={
            <ProtectedRoute>
              <StudentLayout><Notifications /></StudentLayout>
            </ProtectedRoute>
          } />
          <Route path="/organizer/opportunities" element={
            <RoleRoute allowedRoles={["organizer"]}>
              <ManageOpportunities />
            </RoleRoute>
          } />
          <Route path="/organizer/opportunities/:id/applicants" element={
            <RoleRoute allowedRoles={["organizer"]}>
              <OpportunityApplicants />
            </RoleRoute>
          } />
          <Route path="/organizer/analytics" element={
            <RoleRoute allowedRoles={["organizer"]}>
              <OpportunityAnalytics />
            </RoleRoute>
          } />
          <Route path="/admin/moderation" element={
            <RoleRoute allowedRoles={["admin"]}>
              <ModerationQueue />
            </RoleRoute>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
