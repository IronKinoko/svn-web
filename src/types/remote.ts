export type RemoteLocation = {
  id: string
  name: string
  url: string
  username: string
  password?: string
  hasPassword?: boolean
  favorites?: FavoriteFolder[]
  updatedAt?: string
}

export type NewRemoteLocation = Pick<
  RemoteLocation,
  'name' | 'url' | 'username' | 'password'
>

export type FavoriteFolder = {
  path: string
  name: string
  author?: string
  modifiedAt?: string
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

export type FileRevision = {
  revision: number
  author?: string
  modifiedAt?: string
  content: string
}

export type FileComparison = {
  path: string
  current: FileRevision
  previous: FileRevision | null
}

export type RevisionFileChange = {
  path: string
  action: 'A' | 'M' | 'D' | 'R'
  kind: 'file' | 'directory'
}

export type FileHistoryEntry = {
  revision: number
  author?: string
  modifiedAt?: string
  message: string
  files: RevisionFileChange[]
}

export type FileHistory = {
  path: string
  entries: FileHistoryEntry[]
  hasMore: boolean
}

export type LocationDraft = {
  name: string
  url: string
  username: string
  password: string
}
