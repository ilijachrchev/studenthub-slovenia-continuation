function PendingOrgCard({ organization, onApprove, onReject }) {
    return (
        <article className="pending-card">
            <div className="pending-card-body">
                <h3>{organization.name}</h3>

                <p className="pending-card-org">
                    {organization.first_name} {organization.last_name} · {organization.applicant_email}
                </p>
                <p className="pending-card-meta">
                    Contact: {organization.contact_email}
                </p>

                {organization.website && (
                    <p className="pending-card-meta">
                        <a href={organization.website} target="_blank" rel="noreferrer">
                            {organization.website}
                        </a>
                    </p>
                )}

                {organization.description && (
                    <p className="pending-card-desc">
                        {organization.description}
                    </p>
                )}
            </div>

            <div className="pending-card-actions">
                <button type="button" className="btn-approve" onClick={() => onApprove(organization.id)}>
                    Approve
                </button>
                <button type="button" className="btn-reject" onClick={() => onReject(organization.id)}>
                    Reject
                </button>
            </div>
        </article>
    );
}

export default PendingOrgCard;
