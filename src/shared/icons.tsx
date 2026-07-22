import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>{children}</svg>
}

export function ClientsIcon(props: IconProps) {
  return <Icon {...props}><path d="M16 20v-1.7c0-2.2-1.8-4-4-4H6.5c-2.2 0-4 1.8-4 4V20" /><circle cx="9.25" cy="7.4" r="3.4" /><path d="M15.2 4.2a3.4 3.4 0 0 1 0 6.5M17.2 14.5c2.4.35 4.3 1.95 4.3 4V20" /></Icon>
}

export function ScheduleIcon(props: IconProps) {
  return <Icon {...props}><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M7.5 2.5v4M16.5 2.5v4M3 9h18" /><path d="M7.5 13h.01M12 13h.01M16.5 13h.01M7.5 17h.01M12 17h.01" /></Icon>
}

export function AnalyticsIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /><path d="m4 7 5-3 6 5 5-4" /></Icon>
}

export function ProfileIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.6-4 3.2-6.3 7.5-6.3s6.9 2.3 7.5 6.3" /></Icon>
}

export function CloseIcon(props: IconProps) {
  return <Icon {...props}><path d="M6 6l12 12M18 6 6 18" /></Icon>
}
