// Author avatars. Rows ask as they render (only visible rows mount), requests in the same
// frame go to Rust in one call, and a failed image (Gravatar's 404) falls back to initials.
// GitLens tree rows use `shape="square"`: a 16px square image (VS Code draws tree icons
// unclipped), no icon when avatars are off, and the `account` codicon when none loads.
import { useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'
import { git } from '@/lib/git'
import { cn } from '@/lib/utils'
import { useSetting } from '@/settings/settings'

const resolved = new Map<string, string>()
const waiting = new Map<string, Set<(url: string) => void>>()
const pending = new Map<string, { root: string; email: string; sha: string | null }>()
let scheduled = false

function flush() {
  scheduled = false
  const byRoot = new Map<string, { email: string; sha: string | null }[]>()
  for (const { root, email, sha } of pending.values()) {
    byRoot.set(root, [...(byRoot.get(root) ?? []), { email, sha }])
  }
  pending.clear()
  for (const [root, requests] of byRoot) {
    git
      .avatars(root, requests)
      .then((urls) => {
        if (resolved.size > 1000) resolved.clear()
        for (const [email, url] of Object.entries(urls)) {
          resolved.set(email, url)
          for (const notify of waiting.get(email) ?? []) notify(url)
          waiting.delete(email)
        }
      })
      .catch((e: unknown) => {
        console.warn('[gitmenu] avatars failed', e)
        for (const { email } of requests) {
          failed.add(email)
          for (const notify of waiting.get(email) ?? []) notify('')
          waiting.delete(email)
        }
      })
  }
}

function request(root: string, email: string, sha: string | null, notify: (url: string) => void) {
  const set = waiting.get(email) ?? new Set()
  set.add(notify)
  waiting.set(email, set)
  if (!pending.has(email)) pending.set(email, { root, email, sha })
  if (!scheduled) {
    scheduled = true
    requestAnimationFrame(flush)
  }
  return () => {
    set.delete(notify)
  }
}

const failed = new Set<string>()

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

function hue(text: string) {
  let h = 0
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export function Avatar({
  root,
  name,
  email,
  sha,
  className,
  shape = 'circle',
}: {
  root: string
  name: string
  email: string
  sha?: string | null
  className?: string
  shape?: 'circle' | 'square'
}) {
  const enabled = useSetting<boolean>('gitmenu.avatars.enabled')
  const [url, setUrl] = useState(() => resolved.get(email))
  const [broken, setBroken] = useState(() => failed.has(email))

  useEffect(() => {
    if (!enabled || url || !email) return
    return request(root, email, sha ?? null, setUrl)
  }, [enabled, url, root, email, sha])

  const square = shape === 'square'
  const size = cn('size-4 shrink-0', !square && 'rounded-full', className)
  // GitLens shows no icon on a commit when avatars are off
  if (square && !enabled) return null
  if (enabled && url && !broken) {
    return (
      <img
        src={url}
        alt=""
        className={cn(size, !square && 'bg-muted')}
        loading="lazy"
        draggable={false}
        onError={() => {
          failed.add(email)
          setBroken(true)
        }}
      />
    )
  }
  if (square) return <Icon name="account" className={className} />
  return (
    <span
      aria-hidden
      className={cn(size, 'inline-flex items-center justify-center text-[7px] font-semibold text-white')}
      style={{ backgroundColor: `hsl(${hue(email || name)} 45% 50%)` }}
    >
      {initials(name)}
    </span>
  )
}
