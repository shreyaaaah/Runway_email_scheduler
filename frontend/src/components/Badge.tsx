import type { ReactNode } from "react";
import type { EmailStatus } from "../types";

export function Badge({ status, children }: { status: EmailStatus; children?: ReactNode }) {
  const label = status === "processing" ? "Sending" : status[0].toUpperCase() + status.slice(1);
  return <span className={`badge ${status}`}>{children ?? label}</span>;
}
