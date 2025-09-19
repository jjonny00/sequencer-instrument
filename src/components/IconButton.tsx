import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
} from "react";

export type IconButtonTone = "default" | "accent" | "danger" | "ghost";

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: string;
  label: string;
  tone?: IconButtonTone;
  iconSize?: number;
}

const baseStyle: CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 12,
  border: "1px solid #2f384a",
  background: "#111827",
  color: "#e2e8f0",
  cursor: "pointer",
  transition: "background 0.2s ease, color 0.2s ease, border 0.2s ease",
  fontSize: 0,
  lineHeight: 0,
  padding: 0,
  touchAction: "manipulation",
};

const toneStyles: Record<IconButtonTone, CSSProperties> = {
  default: {},
  accent: {
    background: "#27E0B0",
    border: "1px solid #27E0B0",
    color: "#0b1624",
  },
  danger: {
    background: "#2b121d",
    border: "1px solid #831843",
    color: "#fda4af",
  },
  ghost: {
    background: "transparent",
    border: "1px solid transparent",
    color: "#94a3b8",
  },
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { icon, label, tone = "default", iconSize = 24, style, disabled, title, ...props },
    ref
  ) {
    const combinedStyle: CSSProperties = {
      ...baseStyle,
      ...(toneStyles[tone] ?? toneStyles.default),
      ...(style ?? {}),
      cursor: disabled ? "not-allowed" : baseStyle.cursor,
      opacity: disabled ? 0.5 : 1,
    };

    const finalTitle = title ?? label;

    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={finalTitle}
        {...props}
        disabled={disabled}
        style={combinedStyle}
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined"
          style={{
            fontSize: iconSize,
            color: combinedStyle.color,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </span>
      </button>
    );
  }
);
