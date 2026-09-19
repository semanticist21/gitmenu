// AI commit messages with Apple's on-device Foundation Models (src-tauri/src/ai).
import { registerHandler } from '@/commands/registry'
import { toastManager } from '@/components/ui/toast'
import { getCommitInput, repoFrom, setCommitInput } from '@/features/scm/state'
import { t } from '@/i18n'
import type { AppKey } from '@/i18n/app/en'
import { errorMessage, ipc } from '@/lib/ipc'

type Availability = 'available' | 'deviceNotEligible' | 'appleIntelligenceNotEnabled' | 'modelNotReady' | 'unsupportedOs' | 'unknown'

const REASONS: Record<Exclude<Availability, 'available'>, AppKey> = {
  deviceNotEligible: 'ai.deviceNotEligible',
  appleIntelligenceNotEnabled: 'ai.appleIntelligenceNotEnabled',
  modelNotReady: 'ai.modelNotReady',
  unsupportedOs: 'ai.unsupportedOs',
  unknown: 'ai.unknown',
}

const ERRORS: Record<string, AppKey> = {
  'ai:contextWindow': 'ai.contextWindow',
  'ai:guardrail': 'ai.guardrail',
  'ai:failed': 'ai.failed',
  'ai:format': 'ai.format',
  'ai:noChanges': 'ai.noChanges',
  ...Object.fromEntries(Object.entries(REASONS).map(([k, v]) => [`ai:${k}`, v])),
}

export async function availability(): Promise<{ available: boolean; reason?: string }> {
  const state = (await ipc.aiAvailability()) as Availability
  return state === 'available' ? { available: true } : { available: false, reason: t(REASONS[state]) }
}

let running = false

export function registerAiHandlers() {
  registerHandler('gitmenu.generateCommitMessage', async (arg?: unknown) => {
    const root = repoFrom(arg)
    if (!root || running) return
    running = true
    const id = toastManager.add({ type: 'loading', title: t('ai.generating'), timeout: 0 })
    try {
      const message = await ipc.aiCommitMessage(root)
      // Keep what the user already typed below the suggestion
      const current = getCommitInput(root).trim()
      setCommitInput(root, current ? `${message}\n\n${current}` : message)
      toastManager.close(id)
    } catch (error) {
      toastManager.close(id)
      const text = errorMessage(error)
      toastManager.add({ type: 'error', title: ERRORS[text] ? t(ERRORS[text]) : text })
    } finally {
      running = false
    }
  })
}
