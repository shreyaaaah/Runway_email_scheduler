import { Clock3, Star } from "lucide-react";
import type { MouseEvent } from "react";
import type { Email } from "../types";
import { Badge } from "./Badge";

export function EmailRow({ email, onOpen }: { email: Email; onOpen: (email: Email) => void }) {
  function keepStarClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  return <article className="email-row" onClick={() => onOpen(email)}>
    <div className="to">To: {email.toEmail}</div>
    <Badge status={email.status}>
      {email.status === "scheduled" ? <><Clock3 size={11}/>{new Date(email.scheduledAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</> : undefined}
    </Badge>
    <div className="preview"><b>{email.subject}</b><span> - {email.body.replace(/<[^>]*>/g, "").slice(0, 90)}</span></div>
    <button className="star" onClick={keepStarClick} aria-label="Star email"><Star size={16}/></button>
  </article>;
}
