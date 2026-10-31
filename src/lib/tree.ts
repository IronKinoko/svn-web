import type {
  PersistentTreeCache,
  RemoteLocation,
  TreeCache,
  TreeEntry,
} from '../types/remote'

export function isValidTreePath(path: string) {
  return (
    path === '' ||
    (path.length <= 2048 &&
      !path.startsWith('/') &&
      !path.includes('\\') &&
      path.split('/').every((segment) => segment && segment !== '.' && segment !== '..'))
  )
}

export function treeKey(locationId: string, path: string) {
  return `${locationId}:${path}`
}

export function locationCachePrefix(locationId: string) {
  return `${locationId}:`
}

export function cacheIdentityKey(location: RemoteLocation, username: string) {
  return `${location.id}\n${location.url}\n${username}`
}

export function removeLocationKeys<T>(record: Record<string, T>, locationId: string) {
  const prefix = locationCachePrefix(locationId)
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !key.startsWith(prefix)),
  ) as Record<string, T>
}

export function removeLocationKeysFromSet(values: Set<string>, locationId: string) {
  const prefix = locationCachePrefix(locationId)
  return new Set([...values].filter((key) => !key.startsWith(prefix)))
}

export function isTreeSubtreeKey(
  key: string,
  locationId: string,
  path: string,
) {
  if (path === '') return key.startsWith(locationCachePrefix(locationId))
  return key === treeKey(locationId, path) || key.startsWith(`${locationId}:${path}/`)
}

export function removeTreeSubtree<T>(
  record: Record<string, T>,
  locationId: string,
  path: string,
) {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => !isTreeSubtreeKey(key, locationId, path),
    ),
  ) as Record<string, T>
}

export function removeTreeSubtreeFromSet(
  values: Set<string>,
  locationId: string,
  path: string,
) {
  return new Set(
    [...values].filter((key) => !isTreeSubtreeKey(key, locationId, path)),
  )
}

export function removeTreeEntry(
  cache: TreeCache,
  locationId: string,
  path: string,
) {
  const parentPath = path.split('/').slice(0, -1).join('/')
  const parentKey = treeKey(locationId, parentPath)
  const parentEntries = cache[parentKey]
  if (!parentEntries) return cache

  const nextEntries = parentEntries.filter((entry) => entry.path !== path)
  if (nextEntries.length === parentEntries.length) return cache
  return { ...cache, [parentKey]: nextEntries }
}

export function toMemoryTreeCache(
  locationId: string,
  persistent: PersistentTreeCache,
): TreeCache {
  const entries: TreeCache = {}
  for (const [path, directoryEntries] of Object.entries(persistent.entriesByPath)) {
    if (!isValidTreePath(path) || !Array.isArray(directoryEntries)) continue
    entries[treeKey(locationId, path)] = directoryEntries.filter(
      (entry) =>
        entry &&
        typeof entry.name === 'string' &&
        typeof entry.path === 'string' &&
        (entry.kind === 'file' || entry.kind === 'directory'),
    )
  }
  return entries
}

export function isMissingExpandedDirectory(
  cache: TreeCache,
  locationId: string,
  path: string,
) {
  const parentPath = path.split('/').slice(0, -1).join('/')
  const parentEntries = cache[treeKey(locationId, parentPath)] ?? []
  return !parentEntries.some(
    (entry: TreeEntry) => entry.kind === 'directory' && entry.path === path,
  )
}
