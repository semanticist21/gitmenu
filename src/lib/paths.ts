/** A home-relative path the way VS Code prints one (`~/code/gitmenu`). */
export function tildify(path: string) {
  return path.replace(/^\/Users\/[^/]+/, '~')
}
