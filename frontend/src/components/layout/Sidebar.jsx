import { Link, useLocation } from 'react-router-dom';
import logo from "../../assets/logo.png";

function Sidebar() {

    const location = useLocation();

    const links = [
        {label: 'Home', path: '/'},
        {label: "Opportunity hub", path: '/opportunities'},
        {label: "Saved opportunities", path: '/opportunities/saved'},
        {label: "My applications", path: '/opportunities/applications'},
        {label: "Notifications", path: '/notifications'},
        {label: "Saved events", path: '/saved'},
        {label: "My Registrations", path: '/my-registrations'},
        {label: "Settings", path: '/settings'},
    ];

    return (
        <div className='app-sidebar'>
            <div className='sidebar-logo'>
                <img src={logo} alt="StudentHub" className='sidebar-logo-img' />
            </div>

            <nav className='sidebar-nav'>
                {links.map((link) => {
                    const isActive = link.path === "/"
                        ? location.pathname === "/"
                        : location.pathname.startsWith(link.path);

                    return (
                        <Link
                            key={link.path}
                            to={link.path}
                            className={isActive ? "sidebar-link active" : "sidebar-link"}
                        >
                            {link.label}
                        </Link>
                    );
                })}
            </nav>
        </div>
    );
}

export default Sidebar;
