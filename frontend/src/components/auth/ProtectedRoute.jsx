import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import PageState from "../shared/PageState";

export default function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();

    if (loading) {
        return <PageState variant="loading" title="Loading session" message="Checking your account access." />;
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return children;
}
