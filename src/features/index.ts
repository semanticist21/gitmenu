// Feature registrations: command contributions, handlers and views.
import { SparklesIcon } from 'lucide-react'
import { contribute, registerHandler } from '@/commands/registry'
import { registerAiHandlers } from './ai/api'
import { ScmView } from './scm/components/ScmView'
import { scmContribution } from './scm/contribution'
import { commitAndThen, registerScmHandlers } from './scm/handlers'
import { registerView } from './views/registry'

contribute(scmContribution)
contribute({
  commands: [
    { command: 'gitside.generateCommitMessage', title: { app: 'ai.generate' }, category: { text: 'gitside' }, icon: SparklesIcon },
    { command: 'gitside.commitAndPush', title: { vsb: '{0} Commit & Push' } },
    { command: 'gitside.commitAndSync', title: { vsb: '{0} Commit & Sync' } },
  ],
  menus: {
    commandPalette: [
      { command: 'gitside.commitAndPush', when: 'false' },
      { command: 'gitside.commitAndSync', when: 'false' },
    ],
  },
})

registerScmHandlers()
registerAiHandlers()
registerHandler('gitside.commitAndPush', (arg?: unknown) => commitAndThen(arg, 'push'))
registerHandler('gitside.commitAndSync', (arg?: unknown) => commitAndThen(arg, 'sync'))
registerView('scm', ScmView)
