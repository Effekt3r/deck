// 16 px stroke icons, coloured by `currentColor`.
import type { ReactNode } from 'react'

const Svg = ({ size = 14, children }: { size?: number; children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const CloseIcon = ({ size }: { size?: number }) => <Svg size={size}><path d="M4 4l8 8M12 4l-8 8" /></Svg>
export const PlusIcon = ({ size }: { size?: number }) => <Svg size={size}><path d="M8 3v10M3 8h10" /></Svg>
export const UpIcon = () => <Svg><path d="M4 10l4-4 4 4" /></Svg>
export const DownIcon = () => <Svg><path d="M4 6l4 4 4-4" /></Svg>
export const SearchIcon = () => <Svg size={13}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></Svg>
export const SettingsIcon = () => (
  <Svg size={13}>
    <path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7" />
    <circle cx="11" cy="4.5" r="1.5" />
    <circle cx="5" cy="11.5" r="1.5" />
  </Svg>
)

/** A section's fold marker (panel.css: .cp-caret turns it while folded). */
export const Caret = () => (
  <svg className="cp-caret" width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M3.5 5.5h9L8 11z" />
  </svg>
)
