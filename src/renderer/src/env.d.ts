/// <reference types="vite/client" />
import type { DeckApi } from '@shared/types'

declare global {
  interface Window {
    deck: DeckApi
  }
}
