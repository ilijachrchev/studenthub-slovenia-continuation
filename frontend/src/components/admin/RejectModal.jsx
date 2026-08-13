import { useEffect, useRef, useState } from "react";

function RejectModal({event, onCancel, onConfirm, loading}) {
    const [reason, setReason] = useState("");
    const textareaRef = useRef(null);

    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div
                className="modal-card"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="reject-modal-title"
                aria-describedby="reject-modal-description"
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        event.stopPropagation();
                        onCancel();
                    }
                }}
            >
                <h3 id="reject-modal-title">Reject "{event.title}"</h3>
                <p className="modal-subtitle">
                    Let the organizer know why. They will see this on their dashboard.
                </p>
                <p id="reject-modal-description" className="modal-subtitle">
                    Provide a concise explanation for the rejection decision.
                </p>
                <textarea
                    ref={textareaRef}
                    className="input"
                    rows={4}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason for rejection..."
                    aria-describedby="reject-modal-description"
                />
                <div className="modal-actions">
                    <button type="button" className="btn-secondary" onClick={onCancel} disabled={loading}>
                        Cancel
                    </button>
                    <button type="button" className="btn-reject" onClick={() => onConfirm(reason)} disabled={loading || !reason.trim()}>
                        {loading ? "Rejecting..." : "Reject Event"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default RejectModal;
