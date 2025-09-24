import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FC,
  type MouseEvent,
  type ReactNode,
  type TouchEvent,
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
  fullScreen?: boolean;
  disableOverlayClose?: boolean;
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
  overscrollBehavior: "contain",
};

const modalStyle: CSSProperties = {
  width: "100%",
  background: "#111827",
  borderRadius: 20,
  border: "1px solid #1f2937",
  boxShadow: "0 28px 60px rgba(5, 10, 18, 0.6)",
  color: "#e2e8f0",
  display: "flex",
  flexDirection: "column",
  gap: 20,
  maxHeight: "90vh",
  minHeight: 0,
  boxSizing: "border-box",
  overflow: "hidden",
};

export const Modal: FC<ModalProps> = ({
  isOpen,
  title,
  subtitle,
  onClose,
  children,
  footer,
  maxWidth = 420,
  fullScreen = false,
  disableOverlayClose = false,
}) => {
  const labelId = useId();
  const descriptionId = useId();
  const hasSubtitle = Boolean(subtitle);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [footerHeight, setFooterHeight] = useState(0);

  useEffect(() => {
    if (!isOpen) return;

    const win = typeof window !== "undefined" ? window : undefined;
    const doc = typeof document !== "undefined" ? document : undefined;
    if (!win || !doc) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    win.addEventListener("keydown", handleKeyDown);

    const body = doc.body ?? null;
    const root = doc.documentElement ?? null;
    const previousBodyOverflow = body ? body.style.overflow : undefined;
    const previousRootOverflow = root ? root.style.overflow : undefined;
    const previousBodyTouchAction = body ? body.style.touchAction : undefined;
    const previousRootTouchAction = root ? root.style.touchAction : undefined;
    const previousBodyOverscroll = body ? body.style.overscrollBehavior : undefined;
    const previousRootOverscroll = root ? root.style.overscrollBehavior : undefined;
    const previousBodyPosition = body ? body.style.position : undefined;
    const previousBodyTop = body ? body.style.top : undefined;
    const previousBodyLeft = body ? body.style.left : undefined;
    const previousBodyWidth = body ? body.style.width : undefined;
    const scrollY = win?.scrollY ?? 0;
    if (body) {
      body.style.overflow = "hidden";
      body.style.touchAction = "none";
      body.style.overscrollBehavior = "contain";
      body.style.position = "fixed";
      body.style.top = `-${scrollY}px`;
      body.style.left = "0";
      body.style.width = "100%";
    }
    if (root) {
      root.style.overflow = "hidden";
      root.style.touchAction = "none";
      root.style.overscrollBehavior = "contain";
    }

    return () => {
      win.removeEventListener("keydown", handleKeyDown);
      if (body) {
        body.style.overflow = previousBodyOverflow ?? "";
        body.style.touchAction = previousBodyTouchAction ?? "";
        body.style.overscrollBehavior = previousBodyOverscroll ?? "";
        body.style.position = previousBodyPosition ?? "";
        body.style.top = previousBodyTop ?? "";
        body.style.left = previousBodyLeft ?? "";
        body.style.width = previousBodyWidth ?? "";
      }
      if (root) {
        root.style.overflow = previousRootOverflow ?? "";
        root.style.touchAction = previousRootTouchAction ?? "";
        root.style.overscrollBehavior = previousRootOverscroll ?? "";
      }
      if (win) {
        win.scrollTo(0, scrollY);
      }
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !footer) {
      setFooterHeight(0);
      return;
    }
    const element = footerRef.current;
    if (!element) return;

    const updateHeight = () => {
      setFooterHeight(element.getBoundingClientRect().height);
    };

    updateHeight();

    const win = typeof window !== "undefined" ? window : undefined;
    let observer: ResizeObserver | null = null;
    let didAttachResizeListener = false;

    if (win?.ResizeObserver) {
      observer = new win.ResizeObserver(updateHeight);
      observer.observe(element);
    } else if (win) {
      win.addEventListener("resize", updateHeight);
      didAttachResizeListener = true;
    }

    return () => {
      observer?.disconnect();
      if (didAttachResizeListener && win) {
        win.removeEventListener("resize", updateHeight);
      }
    };
  }, [footer, isOpen]);

  if (!isOpen) return null;

  const resolvedOverlayStyle: CSSProperties = fullScreen
    ? {
        ...overlayStyle,
        padding: 0,
        alignItems: "stretch",
        justifyContent: "stretch",
      }
    : overlayStyle;

  const resolvedModalStyle: CSSProperties = fullScreen
    ? {
        ...modalStyle,
        borderRadius: 0,
        border: "none",
        maxWidth: "100%",
        width: "100%",
        height: "100dvh",
        maxHeight: "100dvh",
        minHeight: "100dvh",
      }
    : {
        ...modalStyle,
        maxWidth,
      };

  if (footer) {
    resolvedModalStyle.gap = 0;
  }

  const horizontalPadding = fullScreen ? 20 : 24;
  const topPadding = fullScreen ? 20 : 24;
  const bottomPadding = footer ? 0 : horizontalPadding;

  const bodyWrapperStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    flexBasis: "0%",
    padding: `${topPadding}px ${horizontalPadding}px ${bottomPadding}px`,
  };

  const contentStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    overflowY: "auto",
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    WebkitOverflowScrolling: "touch",
    paddingBottom: footer ? footerHeight + 16 : 0,
  };

  const footerContainerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 16,
    width: "100%",
    padding: `16px ${horizontalPadding}px`,
    paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
    borderTop: "1px solid #1f2937",
    background: "#0f172a",
    boxSizing: "border-box",
  };

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!disableOverlayClose && event.currentTarget === event.target) {
      onClose();
    }
  };

  const handleOverlayTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (!disableOverlayClose && event.currentTarget === event.target) {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      aria-describedby={hasSubtitle ? descriptionId : undefined}
      style={resolvedOverlayStyle}
      onMouseDown={handleOverlayMouseDown}
      onTouchStart={handleOverlayTouchStart}
    >
      <div
        style={resolvedModalStyle}
      >
        <div style={bodyWrapperStyle}>
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
          <div className="scrollable" style={contentStyle}>
            {children}
          </div>
        </div>
        {footer ? (
          <div ref={footerRef} style={footerContainerStyle}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
};
