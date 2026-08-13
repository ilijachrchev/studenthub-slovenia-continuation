import { Link, useLocation } from "react-router-dom";
import logo from "../../assets/logo.png";

function AdminSidebar() {
    const location = useLocation();

    const links = [
        { label: "Pending Events", path: "/admin" },
        { label: "Organizations", path: "/admin/organizations" },
        { label: "Moderation", path: "/admin/moderation" },
    ];

    const isActive = (path) =>
        location.pathname === path || location.pathname.startsWith(`${path}/`);

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
                        className={isActive(link.path) ? "sidebar-link active" : "sidebar-link"}
                    >
                        {link.label}
                    </Link>
                ))}
            </nav>
        </div>
    )
}

export default AdminSidebar;
