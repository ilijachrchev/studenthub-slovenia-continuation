import { useState, useEffect, useCallback } from "react";
import PendingOrgCard from "../../components/admin/PendingOrgCard";
import { apiRequest, getApiErrorMessage } from "../../lib/api";
import "./css/PendingOrganizations.css";

function PendingOrganizations() {
    const [organizations, setOrganizations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const loadPending = useCallback(async (signal) => {
        const data = await apiRequest("/api/admin/organizations/pending", { signal });
        setOrganizations(data.organizations || []);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        async function init() {
            try {
                await loadPending(controller.signal);
            } catch (error) {
                if (controller.signal.aborted || error?.code === "aborted") return;
                setError(getApiErrorMessage(error, "Something went wrong. Please try again"));
            } finally {
                setLoading(false);
            }
        }
        init();
        return () => controller.abort();
    }, [loadPending]);

    const handleApprove = async (id) => {
        setError("");
        try {
            await apiRequest(`/api/admin/organizations/${id}/approve`, {
                method: "POST",
            });
            await loadPending();
        } catch (error) {
            setError(getApiErrorMessage(error, "Something went wrong. Please try again"));
        }
    };

    const handleReject = async (id) => {
        setError("");
        try {
            await apiRequest(`/api/admin/organizations/${id}/reject`, {
                method: "POST",
            });
            await loadPending();
        } catch (error) {
            setError(getApiErrorMessage(error, "Something went wrong. Please try again"));
        }
    };

    if (loading) return <p className="pending-status">Loading...</p>

    return (
        <div className="pending-organizations">
            <div className="pending-header">
                <h1>Pending Organizations</h1>
                <p className="pending-subtitle">
                    {organizations.length} application{organizations.length === 1 ? "" : "s"}
                </p>
            </div>

            {error && <p className="error-text">{error}</p>}

            {organizations.length === 0 ? (
                <p className="pending-status">Nothing to review right now.</p>
            ) : (
                <div className="pending-list">
                    {organizations.map((org) => (
                        <PendingOrgCard
                            key={org.id}
                            organization={org}
                            onApprove={handleApprove}
                            onReject={handleReject}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default PendingOrganizations;
