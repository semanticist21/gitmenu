import { describe, expect, test } from 'bun:test'
import { parseRemoteUrl, providerFor } from './providers'

describe('parseRemoteUrl', () => {
  test('scp, ssh and https forms', () => {
    expect(parseRemoteUrl('git@github.com:kkom/gitside.git')).toEqual({ domain: 'github.com', path: 'kkom/gitside' })
    expect(parseRemoteUrl('ssh://git@gitlab.example.com:2222/group/sub/repo.git')).toEqual({ domain: 'gitlab.example.com', path: 'group/sub/repo' })
    expect(parseRemoteUrl('https://user@github.com/kkom/gitside/')).toEqual({ domain: 'github.com', path: 'kkom/gitside' })
    expect(parseRemoteUrl('/local/path')).toBeNull()
  })
})

describe('providerFor', () => {
  test('GitHub', () => {
    const p = providerFor('git@github.com:kkom/gitside.git')!
    expect(p.commit('abc')).toBe('https://github.com/kkom/gitside/commit/abc')
    expect(p.file('src/a b.ts', { sha: 'abc' }, { start: 3, end: 5 })).toBe('https://github.com/kkom/gitside/blob/abc/src/a%20b.ts#L3-L5')
    expect(p.branch('feat/x')).toBe('https://github.com/kkom/gitside/tree/feat/x')
  })

  test('GitLab and self-hosted via settings', () => {
    expect(providerFor('https://gitlab.com/g/r.git')!.commit('abc')).toBe('https://gitlab.com/g/r/-/commit/abc')
    expect(providerFor('git@git.corp.dev:team/app.git')).toBeNull()
    const p = providerFor('git@git.corp.dev:team/app.git', [{ domain: 'git.corp.dev', type: 'Gitea' }])!
    expect(p.file('a.ts', { branch: 'main' }, { start: 1, end: 1 })).toBe('https://git.corp.dev/team/app/src/branch/main/a.ts#L1')
  })

  test('Azure DevOps over ssh', () => {
    const p = providerFor('git@ssh.dev.azure.com:v3/org/proj/repo')!
    expect(p.repository()).toBe('https://dev.azure.com/org/proj/_git/repo')
    expect(p.commit('abc')).toBe('https://dev.azure.com/org/proj/_git/repo/commit/abc')
  })

  test('Bitbucket Server and custom templates', () => {
    const server = providerFor('https://bb.corp/scm/PRJ/app.git', [{ domain: 'bb.corp', type: 'BitbucketServer' }])!
    expect(server.commit('abc')).toBe('https://bb.corp/projects/PRJ/repos/app/commits/abc')
    const custom = providerFor('git@code.corp:x/y.git', [
      { domain: 'code.corp', type: 'Custom', name: 'Code', urls: { commit: 'https://code.corp/${repo}/c/${id}' } },
    ])!
    expect(custom.name).toBe('Code')
    expect(custom.commit('abc')).toBe('https://code.corp/x/y/c/abc')
  })
})
