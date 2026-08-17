import { forwardRef } from "react";
import "./state.css";

const PageState = forwardRef(function PageState(
  {
    variant = "loading",
    title,
    message,
    actionLabel,
    onAction,
    secondaryActionLabel,
    onSecondaryAction,
    children,
    className = "",
  },
  ref,
) {
  const role = variant === "error" ? "alert" : "status";
  const ariaLive = variant === "error" ? "assertive" : "polite";
  const baseClassName = `page-state page-state-${variant} ${className}`.trim();

  return (
    <section
      ref={ref}
      className={baseClassName}
      role={role}
      aria-live={ariaLive}
      aria-busy={variant === "loading" || undefined}
      tabIndex={variant === "error" ? -1 : undefined}
    >
      {title && <h2 className="page-state-title">{title}</h2>}
      {message && <p className="page-state-message">{message}</p>}
      {children}
      {(onAction || onSecondaryAction) && (
        <div className="page-state-actions">
          {onSecondaryAction && secondaryActionLabel && (
            <button type="button" className="opp-secondary-btn" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </button>
          )}
          {onAction && actionLabel && (
            <button type="button" className="opp-primary-btn" onClick={onAction}>
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </section>
  );
});

function InlineState({ variant = "error", message, onAction, actionLabel, className = "" }) {
  const role = variant === "error" ? "alert" : "status";
  const ariaLive = variant === "error" ? "assertive" : "polite";

  return (
    <div
      className={`inline-state inline-state-${variant} ${className}`.trim()}
      role={role}
      aria-live={ariaLive}
    >
      <p>{message}</p>
      {onAction && actionLabel && (
        <button type="button" className="opp-secondary-btn" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export { InlineState };
export default PageState;
