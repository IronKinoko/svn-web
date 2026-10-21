import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export type TreeEntry = {
  name: string
  path: string
  kind: 'file' | 'directory'
  author?: string
  modifiedAt?: string
}

export type StoredTreeCache = {
  url: string
  username: string
  entriesByPath: Record<string, TreeEntry[]>
  expandedPaths: string[]
  updatedAt: string
}

type CacheDatabase = {
  version: 1
  locations: Record<string, StoredTreeCache>
}

const cacheFile = resolve(
  process.env.SVN_DESK_DATA_DIR ?? resolve(process.cwd(), 'data'),
  'tree-cache.json',
)

let mutationQueue: Promise<void> = Promise.resolve()

export function isValidLocationId(value: string) {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}

export function isValidCachePath(path: string, allowRoot = false) {
  if (path === '') return allowRoot
  return (
    path.length <= 2048 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    path.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
  )
}

function emptyDatabase(): CacheDatabase {
  return { version: 1, locations: {} }
}

async function readDatabase(): Promise<CacheDatabase> {
  try {
    const contents = await readFile(cacheFile, 'utf8')
    const parsed = JSON.parse(contents) as Partial<CacheDatabase>
    if (
      parsed.version !== 1 ||
      !parsed.locations ||
      typeof parsed.locations !== 'object' ||
      Array.isArray(parsed.locations)
    ) {
      throw new Error('SVN tree cache has an unsupported format')
    }
    return parsed as CacheDatabase
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDatabase()
    throw error
  }
}

async function writeDatabase(database: CacheDatabase) {
  await mkdir(dirname(cacheFile), { recursive: true, mode: 0o700 })
  const temporaryFile = `${cacheFile}.${randomUUID()}.tmp`
  await writeFile(temporaryFile, JSON.stringify(database), {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporaryFile, cacheFile)
}

function mutateDatabase<T>(mutate: (database: CacheDatabase) => T) {
  const operation = mutationQueue.then(async () => {
    const database = await readDatabase()
    const result = mutate(database)
    await writeDatabase(database)
    return result
  })
  mutationQueue = operation.then(() => undefined, () => undefined)
  return operation
}

export async function readTreeCache(locationId: string, url: string, username: string) {
  await mutationQueue
  const database = await readDatabase()
  const cached = database.locations[locationId]
  if (!cached || cached.url !== url || cached.username !== username) return null
  return cached
}

export function cacheDirectory(
  locationId: string,
  url: string,
  username: string,
  path: string,
  entries: TreeEntry[],
) {
  return mutateDatabase((database) => {
    const existing = database.locations[locationId]
    const cache =
      existing?.url === url && existing.username === username
        ? existing
        : {
            url,
            username,
            entriesByPath: {},
            expandedPaths: [],
            updatedAt: new Date().toISOString(),
          }

    cache.entriesByPath[path] = entries
    cache.updatedAt = new Date().toISOString()
    database.locations[locationId] = cache
  })
}

export function cacheExpandedPaths(
  locationId: string,
  url: string,
  username: string,
  expandedPaths: string[],
) {
  return mutateDatabase((database) => {
    const existing = database.locations[locationId]
    const cache =
      existing?.url === url && existing.username === username
        ? existing
        : {
            url,
            username,
            entriesByPath: {},
            expandedPaths: [],
            updatedAt: new Date().toISOString(),
          }

    cache.expandedPaths = [...new Set(expandedPaths)]
    cache.updatedAt = new Date().toISOString()
    database.locations[locationId] = cache
  })
}

export function clearTreeCache(locationId: string) {
  return mutateDatabase((database) => {
    delete database.locations[locationId]
  })
}

export function invalidateTreeCacheSubtree(
  locationId: string,
  url: string,
  username: string,
  path: string,
) {
  return mutateDatabase((database) => {
    const cache = database.locations[locationId]
    if (!cache || cache.url !== url || cache.username !== username) return 0

    const prefix = path ? `${path}/` : ''
    const isInSubtree = (candidate: string) =>
      path === '' || candidate === path || candidate.startsWith(prefix)
    const paths = Object.keys(cache.entriesByPath).filter(isInSubtree)

    for (const cachedPath of paths) delete cache.entriesByPath[cachedPath]
    cache.expandedPaths = cache.expandedPaths.filter(
      (cachedPath) => !isInSubtree(cachedPath),
    )
    cache.updatedAt = new Date().toISOString()
    return paths.length
  })
}
