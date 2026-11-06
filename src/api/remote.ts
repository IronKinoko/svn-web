import type {
  FavoriteFolder,
  FileComparison,
  FileHistory,
  NewRemoteLocation,
  PersistentTreeCache,
  RemoteLocation,
  TreeEntry,
} from '../types/remote'

export class RemoteTreePathMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteTreePathMissingError'
  }
}

async function readJson<T>(response: Response) {
  return (await response.json()) as T
}

export async function requestStoredLocations(): Promise<RemoteLocation[]> {
  const response = await fetch('/api/locations', {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  const result = await readJson<{ locations?: RemoteLocation[]; error?: string }>(
    response,
  )
  if (!response.ok) throw new Error(result.error ?? '无法读取后端地址记录')
  return result.locations ?? []
}

export async function createStoredLocation(location: NewRemoteLocation) {
  const response = await fetch('/api/locations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: location.name,
      url: location.url,
      username: location.username,
      ...(location.password !== undefined
        ? { password: location.password }
        : {}),
    }),
  })
  const result = await readJson<{ location?: RemoteLocation; error?: string }>(
    response,
  )
  if (!response.ok || !result.location) {
    throw new Error(result.error ?? '无法保存后端地址记录')
  }
  return result.location
}

export async function updateStoredLocation(location: RemoteLocation) {
  const response = await fetch(
    `/api/locations/${encodeURIComponent(location.id)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(location),
    },
  )
  const result = await readJson<{ location?: RemoteLocation; error?: string }>(
    response,
  )
  if (!response.ok || !result.location) {
    throw new Error(result.error ?? '无法更新后端地址记录')
  }
  return result.location
}

export async function updateStoredLocationFavorites(
  locationId: string,
  favorites: FavoriteFolder[],
) {
  const response = await fetch(
    `/api/locations/${encodeURIComponent(locationId)}/favorites`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ favorites }),
    },
  )
  const result = await readJson<{ location?: RemoteLocation; error?: string }>(
    response,
  )
  if (!response.ok || !result.location) {
    throw new Error(result.error ?? '无法保存收藏目录')
  }
  return result.location
}

export async function deleteStoredLocation(locationId: string) {
  const response = await fetch(
    `/api/locations/${encodeURIComponent(locationId)}`,
    { method: 'DELETE' },
  )
  const result = await readJson<{ error?: string }>(response)
  if (!response.ok) {
    throw new Error(result.error ?? '无法删除后端地址记录')
  }
}

export async function requestRemoteTree(
  location: RemoteLocation,
  path: string,
): Promise<{ entries: TreeEntry[]; cachePersisted: boolean }> {
  const query = new URLSearchParams({ path })
  const response = await fetch(
    `/api/locations/${encodeURIComponent(location.id)}/tree?${query}`,
    {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    },
  )
  const result = await readJson<{
    entries?: TreeEntry[]
    cachePersisted?: boolean
    error?: string
    code?: string
  }>(response)
  if (!response.ok) {
    const message = result.error ?? '无法读取远程 SVN 目录'
    if (result.code === 'SVN_PATH_NOT_FOUND') {
      throw new RemoteTreePathMissingError(message)
    }
    throw new Error(message)
  }
  return {
    entries: result.entries ?? [],
    cachePersisted: result.cachePersisted !== false,
  }
}

export async function requestFileComparison(
  location: RemoteLocation,
  path: string,
  revision?: number,
): Promise<FileComparison> {
  const query = new URLSearchParams({ path })
  if (revision !== undefined) query.set('revision', String(revision))
  const response = await fetch(
    `/api/locations/${encodeURIComponent(location.id)}/file?${query}`,
    {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    },
  )
  const result = await readJson<{ comparison?: FileComparison; error?: string }>(
    response,
  )
  if (!response.ok || !result.comparison) {
    throw new Error(result.error ?? '无法读取文件修订内容')
  }
  return result.comparison
}

export async function requestFileHistory(
  location: RemoteLocation,
  path: string,
  beforeRevision?: number,
): Promise<FileHistory> {
  const query = new URLSearchParams({ path })
  if (beforeRevision !== undefined) {
    query.set('beforeRevision', String(beforeRevision))
  }
  const response = await fetch(
    `/api/locations/${encodeURIComponent(location.id)}/file/history?${query}`,
    {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    },
  )
  const result = await readJson<{ history?: FileHistory; error?: string }>(
    response,
  )
  if (!response.ok || !result.history) {
    throw new Error(result.error ?? '无法读取文件历史')
  }
  return result.history
}

export async function requestPersistentTreeCache(location: RemoteLocation) {
  const response = await fetch(
    `/api/locations/${encodeURIComponent(location.id)}/cache`,
    {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    },
  )
  const result = await readJson<{
    cache?: PersistentTreeCache | null
    error?: string
  }>(response)
  if (!response.ok) throw new Error(result.error ?? '无法读取后端目录缓存')
  return result.cache ?? null
}

export async function savePersistentExpandedPaths(
  location: RemoteLocation,
  expandedPaths: string[],
) {
  const response = await fetch(
    `/api/locations/${encodeURIComponent(location.id)}/cache/expanded`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expandedPaths }),
    },
  )
  if (!response.ok) {
    const result = await readJson<{ error?: string }>(response)
    throw new Error(result.error ?? '无法保存已展开目录')
  }
}

export async function clearPersistentTreeCache(locationId: string) {
  const response = await fetch(
    `/api/locations/${encodeURIComponent(locationId)}/cache`,
    { method: 'DELETE' },
  )
  if (!response.ok) throw new Error('无法清除后端目录缓存')
}

export async function invalidatePersistentTreeSubtree(
  location: RemoteLocation,
  path: string,
) {
  const query = new URLSearchParams({ path })
  const response = await fetch(
    `/api/locations/${encodeURIComponent(location.id)}/cache/entries?${query}`,
    { method: 'DELETE' },
  )
  const result = await readJson<{ invalidated?: number; error?: string }>(
    response,
  )
  if (!response.ok) {
    throw new Error(result.error ?? '无法刷新该节点的后端缓存')
  }
  return result.invalidated ?? 0
}
