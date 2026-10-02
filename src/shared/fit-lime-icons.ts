import { createContext } from 'react'
import asset0 from '../../docs/design/figma-20261002/assets/arrow-left.svg'
import asset1 from '../../docs/design/figma-20261002/assets/arrow-right.svg'
import asset2 from '../../docs/design/figma-20261002/assets/arrow-up.svg'
import asset3 from '../../docs/design/figma-20261002/assets/assistant.svg'
import asset4 from '../../docs/design/figma-20261002/assets/bell.svg'
import asset5 from '../../docs/design/figma-20261002/assets/calendar.svg'
import asset6 from '../../docs/design/figma-20261002/assets/chat.svg'
import asset7 from '../../docs/design/figma-20261002/assets/check-large.svg'
import asset8 from '../../docs/design/figma-20261002/assets/check-small.svg'
import asset9 from '../../docs/design/figma-20261002/assets/check.svg'
import asset10 from '../../docs/design/figma-20261002/assets/checkbox.svg'
import asset11 from '../../docs/design/figma-20261002/assets/clock.svg'
import asset12 from '../../docs/design/figma-20261002/assets/close.svg'
import asset13 from '../../docs/design/figma-20261002/assets/close2.svg'
import asset14 from '../../docs/design/figma-20261002/assets/microphone.svg'
import asset15 from '../../docs/design/figma-20261002/assets/plus.svg'
import asset16 from '../../docs/design/figma-20261002/assets/plus2.svg'
import asset17 from '../../docs/design/figma-20261002/assets/refresh.svg'
import asset18 from '../../docs/design/figma-20261002/assets/settings.svg'
import asset19 from '../../docs/design/figma-20261002/assets/sun.svg'
import asset20 from '../../docs/design/figma-20261002/assets/users.svg'
import asset21 from '../../docs/design/figma-20261002/assets/whistle.svg'

// Presentation only. The server-assigned route gate lives in AppLayout.
// Context also reaches React portals; no account IDs or browser-storage gate.
export const FitLimeIconsContext = createContext(false)
export const fitLimeOriginalIcons: Record<string, string> = {
  'arrow-left': asset0,
  'arrow-right': asset1,
  'arrow-up': asset2,
  'assistant': asset3,
  'bell': asset4,
  'calendar': asset5,
  'chat': asset6,
  'check-large': asset7,
  'check-small': asset8,
  'check': asset9,
  'checkbox': asset10,
  'clock': asset11,
  'close': asset12,
  'close2': asset13,
  'microphone': asset14,
  'plus': asset15,
  'plus2': asset16,
  'refresh': asset17,
  'settings': asset18,
  'sun': asset19,
  'users': asset20,
  'whistle': asset21,
}
export const fitLimeIconNames: Record<string, string> = {
  today: 'checkbox', schedule: 'calendar', clients: 'users',
  assistant: 'assistant', settings: 'settings', close: 'close',
  back: 'arrow-left', 'chevron-right': 'arrow-right', 'arrow-up': 'arrow-up',
  add: 'plus', check: 'check', bell: 'bell', chat: 'chat',
  microphone: 'microphone', mic: 'microphone', message: 'chat', refresh: 'refresh', clock: 'clock',
  sun: 'sun', whistle: 'whistle',
}
