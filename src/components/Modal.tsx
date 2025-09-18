import {
  useEffect,
  useId,
  type CSSProperties,
  type FC,
  type ReactNode,
} from "react";

import { IconButton } from "./IconButton";

interface ModalProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number | string;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(8, 12, 20, 0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "min(32px, 5vw)",
  zIndex: 50,
};

const modalStyle: CSSProperties = {
  width: "100%",
  background: "#111827",
  borderRadius: 20,
  border: "1px solid #1f2937",
  boxShadow: "0 28px 60px rgba(5, 10, 18, 0.6)",
  padding: 24,
  color: "#e2e8f0",
  display: "flex",
  flexDirection: "column",
  gap: 20,
  maxHeight: "90vh",
};

export const Modal: FC<ModalProps> = ({
  isOpen,
  title,
  subtitle,
  onClose,
  children,
  footer,
  maxWidth = 420,
}) => {
  const labelId = useId();
  const descriptionId = useId();
  const hasSubtitle = Boolean(subtitle);

  useEffect(() => {
    if (!isOpen) return;
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      aria-describedby={hasSubtitle ? descriptionId : undefined}
      style={overlayStyle}
      onClick={onClose}
    >
      <div
        style={{ ...modalStyle, maxWidth }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: subtitle ? "flex-start" : "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h2
              id={labelId}
              style={{
                margin: 0,
                fontSize: "1.25rem",
                fontWeight: 700,
                letterSpacing: 0.2,
              }}
            >
              {title}
            </h2>
            {hasSubtitle ? (
              <p
                id={descriptionId}
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: "#94a3b8",
                  lineHeight: 1.5,
                }}
              >
                {subtitle}
              </p>
            ) : null}
          </div>
          <IconButton
            icon="close"
            label="Close"
            tone="ghost"
            onClick={onClose}
            style={{ alignSelf: "flex-start" }}
          />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            overflowY: "auto",
          }}
        >
          {children}
        </div>
        {footer ? <div style={{ display: "flex", justifyContent: "flex-end" }}>{footer}</div> : null}
      </div>
    </div>
  );
};
