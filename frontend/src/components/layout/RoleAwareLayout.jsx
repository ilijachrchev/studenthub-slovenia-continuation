import { useAuth } from "../../context/AuthContext";
import AdminLayout from "./AdminLayout";
import OrganizerLayout from "./OrganizerLayout";
import StudentLayout from "./StudentLayout";

function RoleAwareLayout({ children }) {
  const { user } = useAuth();

  if (user?.role === "admin") {
    return <AdminLayout>{children}</AdminLayout>;
  }

  if (user?.role === "organizer") {
    return <OrganizerLayout>{children}</OrganizerLayout>;
  }

  return <StudentLayout>{children}</StudentLayout>;
}

export default RoleAwareLayout;
