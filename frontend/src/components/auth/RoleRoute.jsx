import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import PageState from "../shared/PageState";

export default function RoleRoute({ allowedRoles, children }) {
    const { user, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <PageState
                variant="loading"
                title="Checking permissions"
                message="Verifying your account role before loading this page."
            />
        );
    }

    if (!user) {
        const next = `${location.pathname}${location.search}${location.hash}`;
        return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
    }

    if (!allowedRoles.includes(user.role)) {
        return <Navigate to="/" replace />;
    }

    return children;
}
