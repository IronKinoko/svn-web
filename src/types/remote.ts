export type RemoteLocation = {
  id: string
  name: string
  url: string
  username: string
  password?: string
  hasPassword?: boolean
  updatedAt?: string
}

export type TreeEntry = {
  name: string
  path: string
  kind: 'file' | 'directory'
  author?: string
  modifiedAt?: string
}

export type TreeRow = TreeEntry & {
  depth: number
}

export type TreeCache = Record<string, TreeEntry[]>

export type PersistentTreeCache = {
  entriesByPath: Record<string, TreeEntry[]>
  expandedPaths: string[]
}

export type LocationDraft = {
  name: string
  url: string
  username: string
  password: string
}
