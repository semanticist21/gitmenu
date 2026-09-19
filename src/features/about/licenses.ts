// The shape of `licenses.json`, which scripts/licenses/licenses.ts builds with the app

export interface LicensedPackage {
  name: string
  version: string
  kind: 'npm' | 'cargo' | 'grammar'
  /** The declared SPDX expression */
  license: string
  /** The registry page, or a grammar's source repository */
  url?: string
  homepage?: string
  /** Indexes into `Licenses.texts` */
  texts: number[]
}

export interface Licenses {
  /** gitmenu's own LICENSE */
  license: string
  /** THIRD_PARTY_NOTICES.md */
  notices: string
  packages: LicensedPackage[]
  texts: string[]
}
