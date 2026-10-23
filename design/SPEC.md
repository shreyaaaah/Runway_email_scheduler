# Runway UI specification

## Visual tokens
- Canvas: white (`#ffffff`); app chrome uses near-black only in the screenshot framing, not in the app.
- Accent: vivid green (`#00ad4e`) for primary actions, selection, chips, and attachment/schedule actions.
- Soft green: `#e5f6ed` for selected navigation rows and Google sign-in surface.
- Text: ink `#171c2b`, secondary slate `#788397`, muted `#a6aeba`; dividers `#e9edf0`; input/editor fill `#f7f8f8`.
- Warning scheduled badge: pale apricot `#fff0dc` with orange text. Sent badge: pale gray.
- Typography: system sans (Inter-like), regular 14px body, 12px metadata, 20px page heading, 30px login heading.
- Radius: 8–12px controls/cards; pills fully rounded. Thin 1px borders, restrained shadows.
- Spacing: 8px base; sidebar 210px; main content inset 24px; compose form max width 790px; detail body max width 520px.

## Components
Button, Input, Modal, Table, Badge, Drawer, Toast, EmptyState; Sidebar, Header, RecipientChips, RichTextToolbar, SchedulePopover, EmailRow, Timeline.

## Screens
- Login: centered narrow bordered card in a white full-page canvas. Heading, pale-green Google button, separator, email/password fields and green Login button.
- Dashboard: fixed slim left rail with pixel-style RUNWAY wordmark, profile, outlined Compose button, CORE navigation (Scheduled/Sent). Main area has wide rounded search, filter and refresh icons, then compact full-width message rows with recipient, status/time pill, subject/snippet, star.
- Message detail: back arrow and subject at top; star/archive/delete tools. Centered sender header and timestamp, body with highlighted callout and attachment cards.
- Compose: back arrow/title, attachment and clock icons plus outlined Send Later action at top right. Centered form: From selector, To line with green recipient chips and Upload List action, Subject, delay/hourly-limit controls, large soft-gray rich-text editor and attachment preview. Scheduling popover is anchored top-right, with date picker, suggested times, Cancel and Done.
- Responsive: sidebar collapses to icon rail on narrow screens; forms and rows become full width; toolbar can scroll.
