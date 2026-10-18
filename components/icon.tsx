import type { SVGProps } from "react";

export type IconName =
  | "alert"
  | "arrow-right"
  | "check"
  | "chevron-down"
  | "clock"
  | "lock"
  | "minus"
  | "plus"
  | "refresh"
  | "shopping-bag"
  | "sparkles"
  | "utensils";

const paths: Record<IconName, string> = {
  alert: "M12 9v4m0 3h.01M10.3 3.6 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3l-7.5-13.4a2 2 0 0 0-3.4 0Z",
  "arrow-right": "M5 12h14m-6-6 6 6-6 6",
  check: "m5 12 4.5 4.5L19 7",
  "chevron-down": "m6 9 6 6 6-6",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  lock: "M7 10V7a5 5 0 0 1 10 0v3m-11 0h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Zm5 5v3",
  minus: "M5 12h14",
  plus: "M12 5v14m-7-7h14",
  refresh: "M20 11a8.1 8.1 0 0 0-14.8-4L3 10m0 0V4m0 6h6m-6 2a8.1 8.1 0 0 0 14.8 4L21 14m0 0v6m0-6h-6",
  "shopping-bag": "M6 8h12l1 12H5L6 8Zm3 0V6a3 3 0 0 1 6 0v2",
  sparkles: "m12 3 1.2 4.8L18 9l-4.8 1.2L12 15l-1.2-4.8L6 9l4.8-1.2L12 3Zm6 10 .6 2.4L21 16l-2.4.6L18 19l-.6-2.4L15 16l2.4-.6L18 13Z",
  utensils: "M7 3v7m3-7v7M5 7h5m-3 3v11m10-18v18m0-18c2 2 3 5 0 8",
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.8,
  ...props
}: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
