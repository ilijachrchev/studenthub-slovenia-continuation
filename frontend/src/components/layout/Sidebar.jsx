import { Link, useLocation } from 'react-router-dom';
import logo from "../../assets/logo.png";

function Sidebar() {

    const location = useLocation();

    const links = [
        {label: 'Home', path: '/'},
        {label: "Opportunities", path: '/opportunities'},
        {label: "Saved Events", path: '/saved'},
        {label: "Saved Opportunities", path: '/saved-opportunities'},
        {label: "My Registrations", path: '/my-registrations'},
        {label: "Applications", path: '/opportunities/applications'},
        {label: "Notifications", path: '/notifications'},
        {label: "Settings", path: '/settings'},
    ];

    const isActive = (path) =>
        path === "/"
            ? location.pathname === "/"
            : location.pathname === path || location.pathname.startsWith(`${path}/`);

    return (
        <div className='app-sidebar'>
            <div className='sidebar-logo'>
                <img src={logo} alt="StudentHub" className='sidebar-logo-img' />
            </div>

            <nav className='sidebar-nav'>
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
    );
}

export default Sidebar;
