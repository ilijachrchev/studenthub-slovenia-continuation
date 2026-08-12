import { useState, useEffect, useCallback } from "react";
import PendingOrgCard from "../../components/admin/PendingOrgCard";
import { getApiErrorMessage, requestJson } from "../../api/http";
import "./css/PendingOrganizations.css";

function PendingOrganizations() {
    const [organizations, setOrganizations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const loadPending = useCallback(async () => {
        const data = await requestJson("/api/admin/organizations/pending");
        setOrganizations(data.organizations || []);
    }, []);

    useEffect(() => {
        async function init() {
            try {
                await loadPending();
            } catch (error) {
                setError(getApiErrorMessage(error, "Something went wrong. Please try again"));
            } finally {
                setLoading(false);
            }
        }
        init();
    }, [loadPending]);

    const handleApprove = async (id) => {
        setError("");
        try {
            await requestJson(`/api/admin/organizations/${id}/approve`, {
                method: "POST",
            });
            await loadPending();
        } catch (error) {
            setError(getApiErrorMessage(error, "Something wen wrong. Please try again"));
        }
    };

    const handleReject = async (id) => {
        setError("");
        try {
            await requestJson(`/api/admin/organizations/${id}/reject`, {
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
