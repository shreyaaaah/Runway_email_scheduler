import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import {
  AlignLeft,
  Archive,
  ArrowLeft,
  Bold,
  ChevronDown,
  Clock3,
  Filter,
  Italic,
  List,
  Paperclip,
  Quote,
  RefreshCw,
  Search,
  Send,
  Star,
  Strikethrough,
  Trash2,
  Underline,
  Upload,
} from "lucide-react";
import { api } from "./api";
import { Badge } from "./components/Badge";
import { Button } from "./components/Button";
import { Drawer } from "./components/Drawer";
import { EmailRow } from "./components/EmailRow";
import { EmptyState } from "./components/EmptyState";
import { Input } from "./components/Input";
import { Modal } from "./components/Modal";
import { Timeline } from "./components/Timeline";
import { Toast } from "./components/Toast";
import type { CampaignPreview, Email, EmailEvent, Sender, User } from "./types";

type Tab = "scheduled" | "sent";
type Page = "list" | "compose";
type ToolbarCommand = "undo" | "redo" | "bold" | "italic" | "underline" | "justifyLeft" | "insertUnorderedList" | "formatBlock" | "strikeThrough";

const toolbarCommands: Array<{ label: string; icon: typeof Bold; command: ToolbarCommand }> = [
  { label: "Undo", icon: ArrowLeft, command: "undo" },
  { label: "Redo", icon: RefreshCw, command: "redo" },
  { label: "Bold", icon: Bold, command: "bold" },
  { label: "Italic", icon: Italic, command: "italic" },
  { label: "Underline", icon: Underline, command: "underline" },
  { label: "Align left", icon: AlignLeft, command: "justifyLeft" },
  { label: "Bullets", icon: List, command: "insertUnorderedList" },
  { label: "Quote", icon: Quote, command: "formatBlock" },
  { label: "Strikethrough", icon: Strikethrough, command: "strikeThrough" },
];

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("scheduled");
  const [items, setItems] = useState<Email[]>([]);
  const [page, setPage] = useState<Page>("list");
  const [selected, setSelected] = useState<Email | null>(null);
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Email[] | null>(null);
  const [toast, setToast] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [delayMinutes, setDelayMinutes] = useState(0);
  const [hourlyLimit, setHourlyLimit] = useState(100);
  const [startAt, setStartAt] = useState(() => new Date(Date.now() + 3_600_000).toISOString().slice(0, 16));
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [slackConnected, setSlackConnected] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  async function loadEmails() {
    try {
      const response = await api.listEmails(tab);
      setItems(response.items);
    } catch {
      setItems([]);
      notify("Could not load emails");
    }
  }

  useEffect(() => {
    void api.me().then(setUser).catch(() => setUser(null));
    void api.senders().then(setSenders).catch(() => setSenders([]));
    void api.slackStatus().then(result => setSlackConnected(result.connected)).catch(() => setSlackConnected(false));
  }, []);

  useEffect(() => {
    if (user) void loadEmails();
  }, [user, tab]);

  useEffect(() => {
    if (page !== "compose") return;
    const timeout = window.setTimeout(() => {
      void api.preview({
        leads: recipients,
        subject: subject || "(no subject)",
        body,
        startAt: new Date(startAt).toISOString(),
        delayMs: delayMinutes * 60_000,
        hourlyLimit,
      }).then(setPreview).catch(() => setPreview(null));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [page, recipients, subject, body, startAt, delayMinutes, hourlyLimit]);

  useEffect(() => {
    if (query.length < 2) {
      setSearchResults(null);
      return;
    }
    const timeout = window.setTimeout(() => {
      void api.search(query).then(result => setSearchResults(result.items)).catch(() => setSearchResults([]));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const visibleEmails = useMemo(() => searchResults ?? items, [searchResults, items]);

  async function createSender() {
    try {
      const sender = await api.createSender();
      setSenders(current => [...current, sender]);
      notify("Ethereal sender created");
    } catch {
      notify("Could not create sender");
    }
  }

  async function createCampaign() {
    try {
      await api.createCampaign({
        leads: recipients,
        subject,
        body,
        startAt: new Date(startAt).toISOString(),
        delayMs: delayMinutes * 60_000,
        hourlyLimit,
      });
      notify("Campaign scheduled");
      setPage("list");
      setTab("scheduled");
      setRecipients([]);
      setSubject("");
      setBody("");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not schedule campaign");
    }
  }

  function parseRecipientFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const found = String(reader.result).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
      setRecipients(current => [...new Set([...current, ...found.map(email => email.toLowerCase())])]);
      setUploadCount(found.length);
      notify(`Detected ${found.length} valid email addresses`);
    };
    reader.readAsText(file);
  }

  async function openEmail(email: Email) {
    setSelected(email);
    try {
      setEvents(await api.events(email.id));
    } catch {
      setEvents([]);
    }
  }

  async function disconnectSlack() {
    try {
      await api.disconnectSlack();
      setSlackConnected(false);
      notify("Slack disconnected");
    } catch {
      notify("Could not disconnect Slack");
    }
  }

  if (!user) {
    return <LoginScreen onNotice={notify}/>;
  }

  return <div className="shell">
    <Sidebar
      user={user}
      tab={tab}
      slackConnected={slackConnected}
      onCompose={() => setPage("compose")}
      onSelectTab={nextTab => { setTab(nextTab); setPage("list"); }}
      onDisconnectSlack={() => void disconnectSlack()}
      onLogout={() => void api.logout().then(() => setUser(null))}
    />
    <section className="main">
      {page === "list" && <EmailList
        emails={visibleEmails}
        query={query}
        onQueryChange={setQuery}
        onRefresh={() => void loadEmails()}
        onCompose={() => setPage("compose")}
        onOpenEmail={email => void openEmail(email)}
      />}
      {page === "compose" && <ComposePage
        user={user}
        senders={senders}
        recipients={recipients}
        subject={subject}
        body={body}
        delayMinutes={delayMinutes}
        hourlyLimit={hourlyLimit}
        startAt={startAt}
        preview={preview}
        uploadCount={uploadCount}
        scheduleOpen={scheduleOpen}
        fileInput={fileInput}
        onBack={() => setPage("list")}
        onSubjectChange={setSubject}
        onBodyChange={setBody}
        onDelayChange={setDelayMinutes}
        onHourlyLimitChange={setHourlyLimit}
        onStartAtChange={setStartAt}
        onToggleSchedule={() => setScheduleOpen(open => !open)}
        onCloseSchedule={() => setScheduleOpen(false)}
        onAddRecipient={email => setRecipients(current => [...new Set([...current, email])])}
        onUpload={parseRecipientFile}
        onCreateSender={() => void createSender()}
        onSchedule={() => void createCampaign()}
      />}
    </section>
    <Drawer
      open={Boolean(selected)}
      title={selected?.subject ?? "Email details"}
      onClose={() => setSelected(null)}
    >
      {selected && <EmailDetails email={selected} user={user} events={events}/>}
    </Drawer>
    <Toast message={toast}/>
  </div>;
}

function LoginScreen({ onNotice }: { onNotice: (message: string) => void }) {
  return <main className="login">
    <section className="login-card">
      <h1>Login</h1>
      <Button className="google" onClick={() => { window.location.href = "/api/auth/google"; }}>🌐　Login with Google</Button>
      <div className="separator"><span>or sign up through email</span></div>
      <Input placeholder="Email ID" type="email"/>
      <Input placeholder="Password" type="password"/>
      <Button variant="primary" onClick={() => onNotice("Use Google sign in to continue")}>Login</Button>
    </section>
  </main>;
}

function Sidebar(props: {
  user: User;
  tab: Tab;
  slackConnected: boolean;
  onCompose: () => void;
  onSelectTab: (tab: Tab) => void;
  onDisconnectSlack: () => void;
  onLogout: () => void;
}) {
  return <aside className="sidebar">
    <div className="logo">RUNWAY</div>
    <button className="profile">
      <span className="avatar">{props.user.name[0] ?? "O"}</span>
      <span><b>{props.user.name}</b><small>{props.user.email}</small></span>
      <ChevronDown size={14}/>
    </button>
    <Button variant="outline" className="compose-outline" onClick={props.onCompose}>Compose</Button>
    <p className="section-label">CORE</p>
    <button className={`nav ${props.tab === "scheduled" ? "active" : ""}`} onClick={() => props.onSelectTab("scheduled")}><Clock3 size={15}/>Scheduled</button>
    <button className={`nav ${props.tab === "sent" ? "active" : ""}`} onClick={() => props.onSelectTab("sent")}><Send size={15}/>Sent</button>
    <div className="sidebar-bottom">
      <Button variant="outline" className="slack" onClick={props.slackConnected ? props.onDisconnectSlack : () => { window.location.href = "/api/slack/connect"; }}>
        {props.slackConnected ? "Disconnect Slack" : "Connect Slack"}
      </Button>
      <small className="slack-status">Slack {props.slackConnected ? "connected" : "not connected"}</small>
      <Button className="logout" onClick={props.onLogout}>Log out</Button>
    </div>
  </aside>;
}

function EmailList(props: {
  emails: Email[];
  query: string;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onCompose: () => void;
  onOpenEmail: (email: Email) => void;
}) {
  return <>
    <header className="searchbar">
      <div className="search"><Search size={16}/><input placeholder="Search" value={props.query} onChange={event => props.onQueryChange(event.target.value)}/></div>
      <button className="icon" aria-label="Filter"><Filter size={15}/></button>
      <button className="icon" onClick={props.onRefresh} aria-label="Refresh"><RefreshCw size={15}/></button>
    </header>
    <div className="rows">
      {props.emails.length === 0
        ? <EmptyState action={<Button onClick={props.onCompose}>Compose an email</Button>}>{props.query ? "No matching emails" : "Your runway is clear"}</EmptyState>
        : props.emails.map(email => <EmailRow key={email.id} email={email} onOpen={props.onOpenEmail}/>)}
    </div>
  </>;
}

function ComposePage(props: {
  user: User;
  senders: Sender[];
  recipients: string[];
  subject: string;
  body: string;
  delayMinutes: number;
  hourlyLimit: number;
  startAt: string;
  preview: CampaignPreview | null;
  uploadCount: number;
  scheduleOpen: boolean;
  fileInput: RefObject<HTMLInputElement>;
  onBack: () => void;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onDelayChange: (value: number) => void;
  onHourlyLimitChange: (value: number) => void;
  onStartAtChange: (value: string) => void;
  onToggleSchedule: () => void;
  onCloseSchedule: () => void;
  onAddRecipient: (email: string) => void;
  onUpload: (file: File | undefined) => void;
  onCreateSender: () => void;
  onSchedule: () => void;
}) {
  function addRecipientFromInput(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    const input = event.currentTarget;
    if (input.value.trim()) props.onAddRecipient(input.value.trim().toLowerCase());
    input.value = "";
  }

  return <section className="compose-page">
    <header className="compose-header">
      <button className="back" onClick={props.onBack}><ArrowLeft size={20}/></button>
      <h2>Compose New Email</h2>
      <div className="actions">
        <button className="icon green" onClick={() => props.fileInput.current?.click()} aria-label="Attach recipients"><Paperclip size={17}/></button>
        <button className="icon green" onClick={props.onToggleSchedule} aria-label="Pick send time"><Clock3 size={17}/></button>
        <Button variant="outline" className="send-later" onClick={props.onToggleSchedule}>Send Later</Button>
      </div>
    </header>
    <div className="form">
      <div className="field-row">
        <label>From</label>
        <button className="from-select">{props.senders[0]?.email ?? props.user.email}<ChevronDown size={14}/></button>
        {props.senders.length === 0 && <Button className="create-sender" onClick={props.onCreateSender}>Create Ethereal sender</Button>}
      </div>
      <div className="field-row recipient-row">
        <label>To</label>
        <div className="chips">
          {props.recipients.slice(0, 3).map(email => <span className="chip" key={email}>{email}</span>)}
          {props.recipients.length > 3 && <span className="chip">+{props.recipients.length - 3}</span>}
          <input placeholder={props.recipients.length ? "Add recipient" : "recipient@example.com"} onKeyDown={addRecipientFromInput}/>
          <button className="upload" onClick={() => props.fileInput.current?.click()}><Upload size={14}/>Upload List</button>
          <input ref={props.fileInput} hidden type="file" accept=".csv,.txt" onChange={event => props.onUpload(event.target.files?.[0])}/>
        </div>
      </div>
      <div className="field-row">
        <label>Subject</label>
        <Input className="line-input" placeholder="Subject" value={props.subject} onChange={event => props.onSubjectChange(event.target.value)}/>
      </div>
      <div className="limits">
        <label>Delay between 2 emails <Input type="number" min="0" value={props.delayMinutes} onChange={event => props.onDelayChange(Number(event.target.value))}/></label>
        <label>Hourly Limit <Input type="number" min="1" value={props.hourlyLimit} onChange={event => props.onHourlyLimitChange(Number(event.target.value))}/></label>
        <label className="start-time">Start <Input type="datetime-local" value={props.startAt} onChange={event => props.onStartAtChange(event.target.value)}/></label>
      </div>
      <div className="editor">
        <div className="placeholder">Type Your Reply...</div>
        <div className="toolbar">
          {toolbarCommands.map(({ label, icon: Icon, command }) => <button key={label} aria-label={label} onClick={() => document.execCommand(command)}><Icon size={16}/></button>)}
        </div>
        <div className="editable" contentEditable suppressContentEditableWarning onInput={event => props.onBodyChange(event.currentTarget.innerHTML)}/>
      </div>
      {props.uploadCount > 0 && <div className="attachment-preview">📎 {props.uploadCount} recipient(s) imported</div>}
      <div className="bottom-actions">
        <span>{props.preview ? `${props.preview.total} recipients · estimated finish ${props.preview.finishAt ? new Date(props.preview.finishAt).toLocaleString() : "—"}` : "Add recipients to plan your runway"}</span>
        <Button variant="primary" onClick={props.onSchedule}>Schedule</Button>
      </div>
      {props.preview && <RunwayPlanner preview={props.preview}/>}
    </div>
    <Modal open={props.scheduleOpen} title="Send Later" onClose={props.onCloseSchedule}>
      <Input label="Pick date & time" type="datetime-local" value={props.startAt} onChange={event => props.onStartAtChange(event.target.value)}/>
      <div className="modal-actions"><Button onClick={props.onCloseSchedule}>Cancel</Button><Button variant="outline" onClick={props.onCloseSchedule}>Done</Button></div>
    </Modal>
  </section>;
}

function RunwayPlanner({ preview }: { preview: CampaignPreview }) {
  const largestBucket = Math.max(1, ...preview.buckets.map(bucket => bucket.count));
  return <div className="planner">
    <b>Runway Planner</b>
    <div className="bars">
      {preview.buckets.map(bucket => <div key={bucket.hour} title={`${new Date(bucket.hour).toLocaleString()}: ${bucket.count}`}>
        <i style={{ height: `${Math.max(8, bucket.count / largestBucket * 100)}%` }}/>
        <small>{new Date(bucket.hour).toLocaleDateString([], { month: "short", day: "numeric" })}</small>
      </div>)}
    </div>
  </div>;
}

function EmailDetails({ email, user, events }: { email: Email; user: User; events: EmailEvent[] }) {
  return <div className="message">
    <div className="sender-line">
      <span className="sender-avatar">{user.name[0] ?? "O"}</span>
      <div><b>{user.name}</b> <small>&lt;{email.sender?.email ?? user.email}&gt;</small><small className="to-me">to me⌄</small></div>
      <small className="date">{new Date(email.sentAt ?? email.scheduledAt).toLocaleString()}</small>
    </div>
    <div className="detail-status"><Badge status={email.status}/></div>
    <div className="message-body" dangerouslySetInnerHTML={{ __html: email.body }}/>
    <div className="detail-actions"><Archive size={16}/><Trash2 size={16}/><Star size={16}/></div>
    <h3>Event timeline</h3>
    <Timeline events={events}/>
  </div>;
}

export default App;
