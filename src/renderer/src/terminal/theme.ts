import type { ITheme } from '@xterm/xterm'

export const FONT_FAMILY = "'SF Mono', Menlo, 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace"
export const FONT_SIZE = 13

/** The branding palette: navy background, amber cursor, teal green, violet selection. */
export const theme: ITheme = {
  background: '#0E1022',
  foreground: '#E6E8F2',
  cursor: '#FF9F43',
  cursorAccent: '#0E1022',
  selectionBackground: '#A78BFA55',
  scrollbarSliderBackground: '#F4F5FB1F',
  scrollbarSliderHoverBackground: '#F4F5FB38',
  scrollbarSliderActiveBackground: '#F4F5FB4D',
  black: '#1A1C33',
  red: '#F7768E',
  green: '#3DDCC1',
  yellow: '#FF9F43',
  blue: '#7AA2F7',
  magenta: '#A78BFA',
  cyan: '#7DCFFF',
  white: '#C0CAF5',
  brightBlack: '#414868',
  brightRed: '#FF8FA3',
  brightGreen: '#6EF2DB',
  brightYellow: '#FFB86B',
  brightBlue: '#9ABDFF',
  brightMagenta: '#C4B0FF',
  brightCyan: '#A4E0FF',
  brightWhite: '#F4F5FB',
}
