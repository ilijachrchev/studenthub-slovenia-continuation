import { Link, useLocation } from "react-router-dom";
import logo from "../../assets/logo.png";
import { useAuth } from "../../context/AuthContext";

function AdminSidebar() {
    const location = useLocation();
    const { user } = useAuth();

    const links = [
        { label: "Pending Events", path: "/admin", roles: ["admin"] },
        { label: "Organizations", path: "/admin/organizations", roles: ["admin"] },
        { label: "Moderation", path: "/admin/moderation", roles: ["admin", "moderator"] },
    ].filter((link) => link.roles.includes(user?.role));

    return (
        <div className="app-sidebar">
            <div className="sidebar-logo">
                <img src={logo} alt="StudentHub" className="sidebar-logo-img"/>
            </div>

            <nav className="sidebar-nav">
                {links.map((link) => (
                    <Link
                        key={link.path}
                        to={link.path}
                        className={location.pathname === link.path ? "sidebar-link active" : "sidebar-link"}
                    >
                        {link.label}
                    </Link>
                ))}
            </nav>
        </div>
    )
}

export default AdminSidebar;
