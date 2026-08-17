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
import ModerationQueue from "./pages/admin/moderation/ModerationQueue";
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
          <Route path="/admin/moderation" element={
            <RoleRoute allowedRoles={["admin", "moderator"]}>
              <ModerationQueue />
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
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}