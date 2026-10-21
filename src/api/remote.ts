import type {
  PersistentTreeCache,
  RemoteLocation,
  TreeEntry,
} from '../types/remote'

async function readJson<T>(response: Response) {
  return (await response.json()) as T
}

export async function requestStoredLocations(): Promise<RemoteLocation[]> {
  const response = await fetch('/api/remote/locations', {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  const result = await readJson<{ locations?: RemoteLocation[]; error?: string }>(
    response,
  )
  if (!response.ok) throw new Error(result.error ?? '无法读取后端地址记录')
  return result.locations ?? []
}

export async function createStoredLocation(location: RemoteLocation) {
  const response = await fetch('/api/remote/locations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(location),
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
    `/api/remote/locations/${encodeURIComponent(location.id)}`,
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

export async function deleteStoredLocation(locationId: string) {
  const response = await fetch(
    `/api/remote/locations/${encodeURIComponent(locationId)}`,
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
  const response = await fetch('/api/remote/tree', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      locationId: location.id,
      url: location.url,
      path,
      username: location.username,
    }),
  })
  const result = await readJson<{
    entries?: TreeEntry[]
    cachePersisted?: boolean
    error?: string
  }>(response)
  if (!response.ok) throw new Error(result.error ?? '无法读取远程 SVN 目录')
  return {
    entries: result.entries ?? [],
    cachePersisted: result.cachePersisted !== false,
  }
}

export async function requestPersistentTreeCache(
  location: RemoteLocation,
  username: string,
) {
  const response = await fetch('/api/remote/cache/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      locationId: location.id,
      url: location.url,
      username,
    }),
  })
  const result = await readJson<{
    cache?: PersistentTreeCache | null
    error?: string
  }>(response)
  if (!response.ok) throw new Error(result.error ?? '无法读取后端目录缓存')
  return result.cache ?? null
}

export async function savePersistentExpandedPaths(
  location: RemoteLocation,
  username: string,
  expandedPaths: string[],
) {
  const response = await fetch('/api/remote/cache/expanded', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      locationId: location.id,
      url: location.url,
      username,
      expandedPaths,
    }),
  })
  if (!response.ok) {
    const result = await readJson<{ error?: string }>(response)
    throw new Error(result.error ?? '无法保存已展开目录')
  }
}

export async function clearPersistentTreeCache(locationId: string) {
  const response = await fetch(
    `/api/remote/cache/${encodeURIComponent(locationId)}`,
    { method: 'DELETE' },
  )
  if (!response.ok) throw new Error('无法清除后端目录缓存')
}

export async function invalidatePersistentTreeSubtree(
  location: RemoteLocation,
  path: string,
) {
  const response = await fetch('/api/remote/cache/invalidate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      locationId: location.id,
      url: location.url,
      username: location.username,
      path,
    }),
  })
  const result = await readJson<{ invalidated?: number; error?: string }>(
    response,
  )
  if (!response.ok) {
    throw new Error(result.error ?? '无法刷新该节点的后端缓存')
  }
  return result.invalidated ?? 0
}
