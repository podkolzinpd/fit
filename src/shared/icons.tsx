import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>{children}</svg>
}

export function ClientsIcon(props: IconProps) {
  return <Icon data-icon="clients" {...props}><path d="M16 20v-1.7c0-2.2-1.8-4-4-4H6.5c-2.2 0-4 1.8-4 4V20" /><circle cx="9.25" cy="7.4" r="3.4" /><path d="M15.2 4.2a3.4 3.4 0 0 1 0 6.5M17.2 14.5c2.4.35 4.3 1.95 4.3 4V20" /></Icon>
}

export function HomeIcon(props: IconProps) {
  return <Icon data-icon="home" {...props}><path d="m3 10 9-7 9 7" /><path d="M5.5 9v11h13V9M9.5 20v-6h5v6" /></Icon>
}

export function TodayIcon(props: IconProps) {
  return <Icon data-icon="today" {...props}><circle cx="12" cy="12" r="8.5" /><path d="m8.2 12.1 2.4 2.4 5.2-5.2" /></Icon>
}

export function AssistantIcon(props: IconProps) {
  return <Icon data-icon="assistant" {...props}><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z" /><path d="m18.2 14.2.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z" /><path d="m6.2 15.2.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7Z" /></Icon>
}

export function ScheduleIcon(props: IconProps) {
  return <Icon data-icon="schedule" {...props}><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M7.5 2.5v4M16.5 2.5v4M3 9h18" /><path d="M7.5 13h.01M12 13h.01M16.5 13h.01M7.5 17h.01M12 17h.01" /></Icon>
}

export function AnalyticsIcon(props: IconProps) {
  return <Icon data-icon="analytics" {...props}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /><path d="m4 7 5-3 6 5 5-4" /></Icon>
}

export function ExerciseIcon(props: IconProps) {
  return <Icon data-icon="exercise" {...props}><path d="M7 9v6M17 9v6M4.5 10.5v3M19.5 10.5v3M7 12h10M2.5 11.5v1M21.5 11.5v1" /></Icon>
}

export function RecordIcon(props: IconProps) {
  return <Icon data-icon="record" {...props}><circle cx="12" cy="9" r="5.5" /><path d="m9 14-1 7 4-2 4 2-1-7M10 9l1.3 1.3L14.5 7" /></Icon>
}

export function HistoryIcon(props: IconProps) {
  return <Icon data-icon="history" {...props}><path d="M3.5 12a8.5 8.5 0 1 0 2.2-5.7L3.5 8.5" /><path d="M3.5 4.5v4h4M12 7.5V12l3 2" /></Icon>
}

export function ProfileIcon(props: IconProps) {
  return <Icon data-icon="profile" {...props}><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.6-4 3.2-6.3 7.5-6.3s6.9 2.3 7.5 6.3" /></Icon>
}

export function SettingsIcon(props: IconProps) {
  return <Icon data-icon="settings" {...props}><circle cx="12" cy="12" r="3.2" /><path d="M19.2 12c0-.5-.05-.98-.14-1.45l2.04-1.6-2-3.46-2.4.97a7.2 7.2 0 0 0-2.5-1.45L13.83 2.5h-4l-.37 2.5c-.92.32-1.77.82-2.5 1.46l-2.4-.97-2 3.46 2.04 1.6a7.4 7.4 0 0 0 0 2.9l-2.04 1.6 2 3.46 2.4-.97c.73.64 1.58 1.14 2.5 1.46l.37 2.5h4l.37-2.51c.92-.32 1.77-.82 2.5-1.45l2.4.97 2-3.46-2.04-1.6c.09-.47.14-.95.14-1.45Z" /></Icon>
}

export function SearchIcon(props: IconProps) {
  return <Icon data-icon="search" {...props}><circle cx="11" cy="11" r="6.5" /><path d="m15.8 15.8 4.7 4.7" /></Icon>
}

export function CloseIcon(props: IconProps) {
  return <Icon data-icon="close" {...props}><path d="M6 6l12 12M18 6 6 18" /></Icon>
}

export function BackIcon(props: IconProps) {
  return <Icon data-icon="back" {...props}><path d="m15 18-6-6 6-6" /></Icon>
}

export function ChevronRightIcon(props: IconProps) {
  return <Icon data-icon="chevron-right" {...props}><path d="m9 18 6-6-6-6" /></Icon>
}

export function ChevronDownIcon(props: IconProps) {
  return <Icon data-icon="chevron-down" {...props}><path d="m6 9 6 6 6-6" /></Icon>
}

export function ArrowUpIcon(props: IconProps) {
  return <Icon data-icon="arrow-up" {...props}><path d="m6.5 10.5 5.5-5.5 5.5 5.5M12 5v14" /></Icon>
}

export function ArrowDownIcon(props: IconProps) {
  return <Icon data-icon="arrow-down" {...props}><path d="m6.5 13.5 5.5 5.5 5.5-5.5M12 19V5" /></Icon>
}

export function MoreIcon(props: IconProps) {
  return <Icon data-icon="more" {...props}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></Icon>
}

export function AddIcon(props: IconProps) {
  return <Icon data-icon="add" {...props}><path d="M12 5v14M5 12h14" /></Icon>
}

export function CheckIcon(props: IconProps) {
  return <Icon data-icon="check" {...props}><path d="m5 12.5 4.2 4.2L19 7" /></Icon>
}

export function AlertIcon(props: IconProps) {
  return <Icon data-icon="alert" {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16.5h.01" /></Icon>
}

export function InfoIcon(props: IconProps) {
  return <Icon data-icon="info" {...props}><circle cx="12" cy="12" r="9" /><path d="M12 10.5v6M12 7.5h.01" /></Icon>
}

export function PendingIcon(props: IconProps) {
  return <Icon data-icon="pending" {...props}><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" /></Icon>
}

export function MicIcon(props: IconProps) {
  return <Icon data-icon="mic" {...props}><rect x="8.2" y="3" width="7.6" height="12" rx="3.8" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" /></Icon>
}

export function StopIcon(props: IconProps) {
  return <Icon data-icon="stop" {...props}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /></Icon>
}
