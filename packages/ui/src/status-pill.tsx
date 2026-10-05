import type { ReactNode } from "react";

export interface StatusPillProps {
  readonly children: ReactNode;
  readonly tone: "positive" | "neutral" | "warning";
}

export function StatusPill({ children, tone }: StatusPillProps) {
  return (
    <span className="status-pill" data-tone={tone}>
      <span className="status-pill__dot" aria-hidden="true" />
      {children}
    </span>
  );
}
