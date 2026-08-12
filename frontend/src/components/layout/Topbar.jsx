import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Bell, LogoutKopce } from "../reusable/Icons";
import { useEffect, useRef, useState } from "react";

function Topbar() {
    const { user, loading, refreshUser } = useAuth();
    const navigate = useNavigate();
    const [term, setTerm] = useState("");
    const [unreadCount, setUnreadCount] = useState(0);
    const timerRef = useRef(null);
    const notificationTimerRef = useRef(null);

    const initials = user
        ? `${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}`.toUpperCase()
        : "";

    const roleLabel = user
        ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
        : "";

    const runSearch = (value) => {
        const query = value.trim();
        if (query) {
            navigate(`/search?q=${encodeURIComponent(query)}`, { replace: true });
        } else {
            navigate("/", { replace: true });
        }
    };

    const handleSearchChange = (e) => {
        const value = e.target.value;
        setTerm(value);

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => runSearch(value), 300);
    };

    const handleSearchKeyDown = (e) => {
        if (e.key === "Enter") {
            if (timerRef.current) clearTimeout(timerRef.current);
            runSearch(term);
        }
    };

    const handleLogout = async () => {
        try {
            await fetch("/api/auth/logout", {
                method: "POST",
                credentials: "include",
            });
        } catch {
            // Ignore logout failures and continue clearing local auth state.
        }
        await refreshUser();
        navigate("/login");
    };

    useEffect(() => {
        if (!user) {
            queueMicrotask(() => setUnreadCount(0));
            return undefined;
        }

        let alive = true;

        const loadUnreadCount = async () => {
            try {
                const response = await fetch("/api/notifications?unread=1", {
                    credentials: "include",
                });
                const data = await response.json().catch(() => ({}));

                if (!alive || !response.ok) return;

                if (typeof data.unreadCount === "number") {
                    setUnreadCount(data.unreadCount);
                    return;
                }

                const items = Array.isArray(data)
                    ? data
                    : data.notifications || data.items || data.data || [];
                setUnreadCount(items.length);
            } catch {
                if (alive) setUnreadCount(0);
            }
        };

        loadUnreadCount();
        notificationTimerRef.current = setInterval(loadUnreadCount, 60000);

        return () => {
            alive = false;
            if (notificationTimerRef.current) clearInterval(notificationTimerRef.current);
        };
    }, [user]);

    return (
        <header className="app-topbar">
            <input
                type="text"
                className="topbar-search"
                placeholder="Search events, organizations, or topics..."
                value={term}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
            />

            <div className="topbar-actions">
                <button
                    className="topbar-icon-button topbar-icon-wrap"
                    aria-label="Notifications"
                    onClick={() => navigate("/notifications")}
                >
                    <Bell size={20} />
                    {unreadCount > 0 && <span className="topbar-unread-badge">{unreadCount}</span>}
                </button>

                {!loading && user && (
                    <button
                        className="topbar-icon-button"
                        aria-label="Log out"
                        onClick={handleLogout}
                        style={{ color: "#ff0000" }}
                    >
                        <LogoutKopce size={20} />
                    </button>
                )}

                {!loading && user && (
                    <button className="topbar-profile">
                        <span className="topbar-avatar">{initials}</span>
                        <span className="topbar-profile-info">
                            <span className="topbar-profile-name">{user.first_name}</span>
                            <span className="topbar-profile-role">{roleLabel}</span>
                        </span>
                    </button>
                )}

                {!loading && !user && (
                    <button className="topbar-profile topbar-profile-guest" onClick={() => navigate("/login")}>
                        Sign In
                    </button>
                )}
            </div>
        </header>
    );
}

export default Topbar;
