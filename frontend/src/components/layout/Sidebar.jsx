import { Link, useLocation } from 'react-router-dom';
import logo from "../../assets/logo.png";

function Sidebar() {

    const location = useLocation();

    const links = [
        {label: 'Home', path: '/'},
        {label: "Opportunities", path: '/opportunities'},
        {label: "My Applications", path: '/my-applications'},
        {label: "Saved", path: '/saved'},
        {label: "My Registrations", path: '/my-registrations'},
        {label: "Settings", path: '/settings'},
    ];

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
                        className={location.pathname === link.path ? "sidebar-link active" : "sidebar-link"}
                    >
                        {link.label}
                    </Link>
                ))}
            </nav>
        </div>
    );
}

export default Sidebar;
