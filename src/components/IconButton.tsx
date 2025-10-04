import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
} from "react";

export type IconButtonTone = "default" | "accent" | "danger" | "ghost";
export type IconButtonSize = "default" | "compact";

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: string;
  label: string;
  tone?: IconButtonTone;
  iconSize?: number;
  showLabel?: boolean;
  description?: string;
  size?: IconButtonSize;
}

const baseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid #2f384a",
  background: "#111827",
  color: "#e2e8f0",
  cursor: "pointer",
  transition: "background 0.2s ease, color 0.2s ease, border 0.2s ease",
  fontSize: 0,
  lineHeight: 0,
  touchAction: "manipulation",
};

const sizeStyles: Record<IconButtonSize, CSSProperties> = {
  default: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 12,
  },
  compact: {
    width: 36,
    height: 36,
    minWidth: 36,
    minHeight: 36,
    borderRadius: 18,
  },
};

const iconPaddingStyles: Record<IconButtonSize, CSSProperties> = {
  default: {
    padding: 0,
    gap: 0,
  },
  compact: {
    padding: 0,
    gap: 0,
  },
};

const iconWithLabelStyle: CSSProperties = {
  padding: "10px 14px",
  gap: 10,
  fontSize: 14,
  lineHeight: "20px",
  fontWeight: 600,
  justifyContent: "flex-start",
  alignItems: "center",
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
    {
      icon,
      label,
      tone = "default",
      iconSize = 24,
      showLabel = false,
      description,
      size = "default",
      style,
      disabled,
      title,
      ...props
    },
    ref
  ) {
    const hasTextContent = showLabel || Boolean(description);
    const sizeStyle = sizeStyles[size] ?? sizeStyles.default;
    const iconOnlyStyle = iconPaddingStyles[size] ?? iconPaddingStyles.default;

    const combinedStyle: CSSProperties = {
      ...baseStyle,
      ...sizeStyle,
      ...(toneStyles[tone] ?? toneStyles.default),
      ...(hasTextContent ? iconWithLabelStyle : iconOnlyStyle),
      ...(style ?? {}),
      cursor: disabled ? "not-allowed" : baseStyle.cursor,
      opacity: disabled ? 0.5 : 1,
    };

    const accessibleLabel = description
      ? `${label}. ${description}`
      : label;
    const finalTitle = title ?? accessibleLabel;

    return (
      <button
        ref={ref}
        type="button"
        aria-label={accessibleLabel}
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
        {hasTextContent ? (
          <span
            aria-hidden="true"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: description ? 2 : 0,
              color: combinedStyle.color,
              textAlign: "left",
              fontSize: iconWithLabelStyle.fontSize,
              lineHeight: iconWithLabelStyle.lineHeight,
              fontWeight: iconWithLabelStyle.fontWeight,
            }}
          >
            {showLabel ? (
              <span style={{ fontSize: 15, lineHeight: "20px", fontWeight: 600 }}>
                {label}
              </span>
            ) : null}
            {description ? (
              <span
                style={{
                  fontSize: 12,
                  lineHeight: "16px",
                  fontWeight: 500,
                  color: "#94a3b8",
                }}
              >
                {description}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
    );
  }
);
