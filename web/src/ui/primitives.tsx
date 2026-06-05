import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export function Panel({
  children,
  className,
  flush,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return <section className={`panel ${flush ? "panel--flush" : ""} ${className ?? ""}`}>{children}</section>;
}

export function PanelTitle({
  icon,
  eyebrow,
  title,
  right,
}: {
  icon?: IconName;
  eyebrow?: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <header className="panel-title">
      {icon && (
        <span className="panel-title__icon">
          <Icon name={icon} size={18} />
        </span>
      )}
      <div className="panel-title__text">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {right && <div className="panel-title__right">{right}</div>}
    </header>
  );
}

export function Stat({
  label,
  value,
  icon,
  tone,
  sub,
}: {
  label: string;
  value: ReactNode;
  icon?: IconName;
  tone?: "positive" | "negative" | "warn";
  sub?: ReactNode;
}) {
  return (
    <div className="stat">
      {icon && <Icon name={icon} size={16} />}
      <span className="stat__label">{label}</span>
      <strong className={`stat__value ${tone ? `is-${tone}` : ""}`}>{value}</strong>
      {sub && <span className="stat__sub">{sub}</span>}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "warn" | "accent" | "info";
  className?: string;
}) {
  return <span className={`badge badge--${tone} ${className ?? ""}`}>{children}</span>;
}

export function Bar({
  value,
  max = 1,
  tone = "accent",
}: {
  value: number;
  max?: number;
  tone?: "accent" | "positive" | "negative" | "warn";
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="bar">
      <span className={`bar__fill bar__fill--${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Lightweight SVG sparkline for price / valuation series. */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "var(--accent)",
  fill = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  if (data.length < 2) {
    return <svg className="sparkline" width={width} height={height} aria-hidden />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const dx = width / (data.length - 1);
  const pts = data.map((v, i) => [i * dx, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const up = data[data.length - 1]! >= data[0]!;
  const stroke = color === "auto" ? (up ? "var(--positive)" : "var(--negative)") : color;
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {fill && <path d={area} fill={stroke} opacity={0.12} />}
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? "is-active" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <Icon name={icon} size={22} />}
      <span>{children}</span>
    </div>
  );
}

export function ActionButton({
  icon,
  children,
  onClick,
  variant = "ghost",
  disabled,
  title,
}: {
  icon?: IconName;
  children: ReactNode;
  onClick?: () => void;
  variant?: "ghost" | "primary" | "danger";
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`act act--${variant}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon && <Icon name={icon} size={15} />}
      <span>{children}</span>
    </button>
  );
}
