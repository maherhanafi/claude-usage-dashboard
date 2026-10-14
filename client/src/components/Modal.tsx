import { useEffect, type ReactNode } from "react";

/** Centered overlay dialog. Closes on backdrop click or Escape. */
export function Modal({
  onClose,
  children,
  maxWidth,
  fullscreen = false,
}: {
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number;
  fullscreen?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-wrap${fullscreen ? " modal-wrap-fullscreen" : ""}`}
        role="dialog"
        aria-modal="true"
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
