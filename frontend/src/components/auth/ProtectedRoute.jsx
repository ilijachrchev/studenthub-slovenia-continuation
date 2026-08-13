import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { buildLoginPath } from "../../lib/auth";

export default function ProtectedRoute({ children }) {
    const { user, loading, sessionExpired } = useAuth();
    const location = useLocation();

    if (loading) {
        return <p className="route-status" role="status">Checking session...</p>;
    }

    if (!user) {
        return (
            <Navigate
                to={buildLoginPath({
                    next: `${location.pathname}${location.search}`,
                    reason: sessionExpired ? "session-expired" : undefined,
                })}
                replace
            />
        );
    }

    return children;
}
