import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { IconButton } from "./IconButton";

interface OverflowMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

interface OverflowMenuButtonProps {
  label: string;
  items: OverflowMenuItem[];
  icon?: string;
}

const MENU_CONTAINER_STYLE: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  right: 0,
  minWidth: 180,
  padding: 8,
  borderRadius: 12,
  border: "1px solid #1f2937",
  background: "rgba(15, 23, 42, 0.95)",
  boxShadow: "0 16px 32px rgba(2, 6, 14, 0.6)",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  zIndex: 100,
};

const MENU_ITEM_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid transparent",
  background: "transparent",
  color: "#e2e8f0",
  fontSize: 14,
  fontWeight: 600,
  textAlign: "left",
  cursor: "pointer",
  transition: "background 0.2s ease, border 0.2s ease, color 0.2s ease",
};

const MENU_ITEM_DISABLED_STYLE: CSSProperties = {
  opacity: 0.5,
  cursor: "not-allowed",
};

export function OverflowMenuButton({
  label,
  items,
  icon = "more_vert",
}: OverflowMenuButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current) return;
      if (event.target instanceof Node && containerRef.current.contains(event.target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleToggle = () => {
    setOpen((prev) => !prev);
  };

  const handleSelect = (item: OverflowMenuItem) => {
    if (item.disabled) return;
    setOpen(false);
    item.onSelect();
  };

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-flex" }}>
      <IconButton
        icon={icon}
        label={label}
        size="compact"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={handleToggle}
      />
      {open ? (
        <div role="menu" style={MENU_CONTAINER_STYLE}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => handleSelect(item)}
              disabled={item.disabled}
              style={{
                ...MENU_ITEM_STYLE,
                ...(item.disabled ? MENU_ITEM_DISABLED_STYLE : null),
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
