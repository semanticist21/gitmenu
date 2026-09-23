// Whether the detail tab containing the caller is the window's active one. Hidden tabs stay
// mounted (DetailApp keeps them alive so switching back is instant), but a hidden editor must
// not answer global commands or hold context keys: only the active tab registers those.
import { createContext, useContext } from 'react'

export const TabActiveContext = createContext(true)

export function useIsTabActive() {
  return useContext(TabActiveContext)
}
