import type { SVGProps } from "react";

export type IconName =
  | "dashboard"
  | "map"
  | "exchange"
  | "systems"
  | "convoys"
  | "fleet"
  | "finance"
  | "report"
  | "plus"
  | "x"
  | "send"
  | "lock"
  | "crosshair"
  | "radar"
  | "search"
  | "wallet"
  | "trending"
  | "gavel"
  | "alert"
  | "check"
  | "clock"
  | "chevron"
  | "ship"
  | "flask"
  | "shield"
  | "bolt"
  | "info"
  | "skull"
  | "palette"
  | "logout";

const paths: Record<IconName, string> = {
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
  exchange: "M4 19V5M4 19h16M8 17v-5M12 17V8M16 17v-7M20 17v-3",
  systems: "M3 21V9l6-4 6 4M3 21h18M15 21V11l6 3v7M7 21v-4h4v4",
  convoys: "M2 7l9-4 9 4-9 4-9-4zM2 7v10l9 4 9-4V7M11 11v10",
  fleet: "M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4zM9 12l2 2 4-4",
  finance: "M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M3 10l9-6 9 6z",
  report: "M6 2h9l5 5v15H6zM15 2v5h5M9 12h7M9 16h7M9 8h3",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6 6 18",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  lock: "M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z",
  crosshair: "M12 2v4M12 18v4M2 12h4M18 12h4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
  radar: "M12 12 19 5M12 3a9 9 0 1 0 9 9h-9z",
  search: "M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-4.3-4.3",
  wallet: "M3 6h16v12H3zM3 6l13-3v3M17 12h3",
  trending: "M3 17l6-6 4 4 8-8M21 7v5h-5",
  gavel: "M14 3l7 7-3 3-7-7zM10 7l4 4-7 7-4-4zM3 21h8",
  alert: "M12 3 2 20h20zM12 9v5M12 17h.01",
  check: "M4 12l5 5L20 6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v4l3 2",
  chevron: "M9 6l6 6-6 6",
  ship: "M3 16l2-6h14l2 6M5 10V6h4l3 4M12 4v6M4 16c2 2 4 2 6 0s4-2 6 0 4 2 4 0",
  flask: "M9 3h6M10 3v6l-5 10h14L14 9V3",
  shield: "M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4z",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01",
  skull: "M12 2a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14zM9 12h.01M15 12h.01",
  palette: "M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-1-1-2 1-1 2-1h2a4 4 0 0 0 4-4c0-4.5-4-9-9-9zM7 12h.01M10 8h.01M15 8h.01",
  logout: "M9 21H4V3h5M16 17l5-5-5-5M21 12H9",
};

export function Icon({
  name,
  size = 18,
  ...props
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
