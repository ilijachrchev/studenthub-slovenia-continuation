import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import PageState from "../shared/PageState";

export default function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <PageState
                variant="loading"
                title="Checking your session"
                message="Verifying your account before loading this page."
            />
        );
    }

    if (!user) {
        const next = `${location.pathname}${location.search}${location.hash}`;
        return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
    }

    return children;
}
