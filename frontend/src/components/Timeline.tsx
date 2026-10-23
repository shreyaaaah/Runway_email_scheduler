import type { EmailEvent } from "../types";

export function Timeline({ events }: { events: EmailEvent[] }) {
  return <div className="timeline">
    {events.map(event => <div className="event" key={event.id}>
      <i/>{event.type.replace(/_/g, " ")}
      <small>{new Date(event.createdAt).toLocaleString()}</small>
    </div>)}
  </div>;
}
