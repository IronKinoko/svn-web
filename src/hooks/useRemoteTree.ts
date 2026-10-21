import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  invalidatePersistentTreeSubtree,
  requestPersistentTreeCache,
  requestRemoteTree,
  savePersistentExpandedPaths,
} from '../api/remote'
import {
  cacheIdentityKey,
  isMissingExpandedDirectory,
  isValidTreePath,
  locationCachePrefix,
  removeLocationKeys,
  removeLocationKeysFromSet,
  removeTreeSubtree,
  removeTreeSubtreeFromSet,
  toMemoryTreeCache,
  treeKey,
} from '../lib/tree'
import type { RemoteLocation, TreeCache, TreeRow } from '../types/remote'

type CacheInput = {
  activeLocation?: RemoteLocation
  activeLocationId: string | null
  reportError: (message: string | null) => void
}

export function useRemoteTree({
  activeLocation,
  activeLocationId,
  reportError,
}: CacheInput) {
  const [cache, setCache] = useState<TreeCache>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [hydratedCacheIdentity, setHydratedCacheIdentity] = useState<string | null>(
    null,
  )
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set())
  const [pathErrors, setPathErrors] = useState<Record<string, string>>({})
  const [expandedReload, setExpandedReload] = useState(0)
  const inFlightKeys = useRef(new Set<string>())
  const unavailableExpandedKeys = useRef(new Set<string>())

  const activeCacheIdentity = activeLocation
    ? cacheIdentityKey(activeLocation, activeLocation.username)
    : null
  const loadingIdentity = activeLocation && !hydratedCacheIdentity
    ? activeCacheIdentity
    : null
  const effectiveLoadingKeys = loadingIdentity && activeLocationId
    ? new Set(loadingKeys).add(treeKey(activeLocationId, ''))
    : loadingKeys

  useEffect(() => {
    if (!activeLocation || !activeCacheIdentity) return

    let cancelled = false
    const location = activeLocation
    const identity = activeCacheIdentity
    const prefix = locationCachePrefix(location.id)
    const rootKey = treeKey(location.id, '')

    void requestPersistentTreeCache(location, location.username)
      .then((persistent) => {
        if (cancelled) return
        const restoredCache = persistent
          ? toMemoryTreeCache(location.id, persistent)
          : {}
        setCache((current) => ({
          ...Object.fromEntries(
            Object.entries(current).filter(([key]) => !key.startsWith(prefix)),
          ),
          ...restoredCache,
        }))
        setExpanded((current) => {
          const next = removeLocationKeysFromSet(current, location.id)
          for (const path of persistent?.expandedPaths ?? []) {
            if (typeof path === 'string' && isValidTreePath(path) && path) {
              next.add(treeKey(location.id, path))
            }
          }
          return next
        })
        setPathErrors((current) => removeLocationKeys(current, location.id))
        if (restoredCache[rootKey]) {
          setLoadingKeys((current) => {
            const next = new Set(current)
            next.delete(rootKey)
            return next
          })
        }
        setHydratedCacheIdentity(identity)
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        const message = caught instanceof Error ? caught.message : '无法读取后端目录缓存'
        reportError(`读取后端目录缓存失败，将尝试连接 SVN：${message}`)
        setHydratedCacheIdentity(identity)
      })

    return () => {
      cancelled = true
    }
  }, [activeLocation, activeCacheIdentity, reportError])

  useEffect(() => {
    if (!activeLocation || hydratedCacheIdentity !== activeCacheIdentity) return
    const location = activeLocation
    const key = treeKey(location.id, '')
    if (Object.hasOwn(cache, key) || inFlightKeys.current.has(key)) return

    let cancelled = false
    inFlightKeys.current.add(key)
    requestRemoteTree(location, '')
      .then(({ entries, cachePersisted }) => {
        setCache((current) => ({ ...current, [key]: entries }))
        setPathErrors((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
        if (!cancelled) {
          reportError(
            cachePersisted
              ? null
              : '目录读取成功，但后端未能保存缓存。请检查容器数据目录权限。',
          )
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : '无法读取远程 SVN 目录'
          setPathErrors((current) => ({ ...current, [key]: message }))
          reportError(message)
        }
      })
      .finally(() => {
        inFlightKeys.current.delete(key)
        setLoadingKeys((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      })

    return () => {
      cancelled = true
    }
  }, [activeLocation, activeCacheIdentity, cache, hydratedCacheIdentity, reportError])

  const visibleEntries = useMemo<TreeRow[]>(() => {
    if (!activeLocationId || hydratedCacheIdentity !== activeCacheIdentity) return []
    const rows: TreeRow[] = []

    const visit = (path: string, depth: number) => {
      for (const entry of cache[treeKey(activeLocationId, path)] ?? []) {
        rows.push({ ...entry, depth })
        if (
          entry.kind === 'directory' &&
          expanded.has(treeKey(activeLocationId, entry.path))
        ) {
          visit(entry.path, depth + 1)
        }
      }
    }

    visit('', 0)
    return rows
  }, [activeLocationId, activeCacheIdentity, cache, expanded, hydratedCacheIdentity])

  const loadDirectory = useCallback(async (location: RemoteLocation, path: string) => {
    const key = treeKey(location.id, path)
    if (Object.hasOwn(cache, key) || inFlightKeys.current.has(key)) return

    inFlightKeys.current.add(key)
    setLoadingKeys((current) => new Set(current).add(key))
    try {
      const result = await requestRemoteTree(location, path)
      setCache((current) => ({ ...current, [key]: result.entries }))
      setPathErrors((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      reportError(
        result.cachePersisted
          ? null
          : '目录读取成功，但后端未能保存缓存。请检查容器数据目录权限。',
      )
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '无法读取远程 SVN 目录'
      setPathErrors((current) => ({ ...current, [key]: message }))
      reportError(message)
    } finally {
      inFlightKeys.current.delete(key)
      setLoadingKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }, [cache, reportError])

  useEffect(() => {
    if (!activeLocation || hydratedCacheIdentity !== activeCacheIdentity) return
    const prefix = locationCachePrefix(activeLocation.id)
    const paths = [...expanded]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort((left, right) => {
        const depthDifference = left.split('/').length - right.split('/').length
        return depthDifference || left.localeCompare(right)
      })
    let nextPath: string | undefined
    for (const path of paths) {
      const key = treeKey(activeLocation.id, path)
      if (unavailableExpandedKeys.current.has(key)) continue
      const parentPath = path.split('/').slice(0, -1).join('/')
      const parentKey = treeKey(activeLocation.id, parentPath)
      if (!Object.hasOwn(cache, parentKey) || Object.hasOwn(cache, key)) continue
      if (isMissingExpandedDirectory(cache, activeLocation.id, path)) {
        unavailableExpandedKeys.current.add(key)
        continue
      }
      nextPath = path
      break
    }
    if (!nextPath) return

    // Restoring an expanded path starts a real request with its own loading state.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadDirectory(activeLocation, nextPath)
  }, [
    activeLocation,
    activeCacheIdentity,
    cache,
    expanded,
    expandedReload,
    hydratedCacheIdentity,
    loadDirectory,
  ])

  const toggleDirectory = (entry: { name: string; path: string }) => {
    if (!activeLocation) return
    const key = treeKey(activeLocation.id, entry.path)
    unavailableExpandedKeys.current.delete(key)
    const isOpen = expanded.has(key)
    const shouldRetry = isOpen && Boolean(pathErrors[key])
    const next = new Set(expanded)
    if (isOpen && !shouldRetry) next.delete(key)
    else next.add(key)
    setExpanded(next)
    const expandedPaths = [...next]
      .filter((expandedKey) => expandedKey.startsWith(locationCachePrefix(activeLocation.id)))
      .map((expandedKey) => expandedKey.slice(activeLocation.id.length + 1))
    void savePersistentExpandedPaths(
      activeLocation,
      activeLocation.username,
      expandedPaths,
    ).catch((caught: unknown) => {
      reportError(caught instanceof Error ? caught.message : '无法保存已展开目录')
    })
    if (!isOpen || shouldRetry) void loadDirectory(activeLocation, entry.path)
  }

  const refreshEntry = async (entry: TreeRow) => {
    if (!activeLocation) return
    const location = activeLocation
    const entryKey = treeKey(location.id, entry.path)
    if (inFlightKeys.current.has(entryKey)) return

    inFlightKeys.current.add(entryKey)
    setLoadingKeys((current) => new Set(current).add(entryKey))
    try {
      await invalidatePersistentTreeSubtree(location, entry.path)
    } catch (caught) {
      inFlightKeys.current.delete(entryKey)
      setLoadingKeys((current) => {
        const next = new Set(current)
        next.delete(entryKey)
        return next
      })
      reportError(caught instanceof Error ? caught.message : '无法刷新该节点的缓存')
      return
    }

    setCache((current) => removeTreeSubtree(current, location.id, entry.path))
    setExpanded((current) =>
      removeTreeSubtreeFromSet(current, location.id, entry.path),
    )
    setPathErrors((current) =>
      removeTreeSubtree(current, location.id, entry.path),
    )
    reportError(null)

    try {
      const result = await requestRemoteTree(location, entry.path)
      setCache((current) => ({ ...current, [entryKey]: result.entries }))
      if (entry.kind === 'directory') {
        const nextExpanded = new Set(expanded).add(entryKey)
        setExpanded(nextExpanded)
        const expandedPaths = [...nextExpanded]
          .filter((key) => key.startsWith(`${location.id}:`))
          .map((key) => key.slice(location.id.length + 1))
        void savePersistentExpandedPaths(
          location,
          location.username,
          expandedPaths,
        ).catch((caught: unknown) => {
          reportError(
            caught instanceof Error ? caught.message : '无法保存已展开目录',
          )
        })
      }
      setExpandedReload((current) => current + 1)
      reportError(
        result.cachePersisted
          ? null
          : '目录读取成功，但后端未能保存缓存。请检查容器数据目录权限。',
      )
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '无法刷新该节点'
      setPathErrors((current) => ({ ...current, [entryKey]: message }))
      reportError(message)
    } finally {
      inFlightKeys.current.delete(entryKey)
      setLoadingKeys((current) => {
        const next = new Set(current)
        next.delete(entryKey)
        return next
      })
    }
  }

  const clearLocationCache = (locationId: string) => {
    setCache((current) => removeLocationKeys(current, locationId))
    setExpanded((current) => removeLocationKeysFromSet(current, locationId))
    setPathErrors((current) => removeLocationKeys(current, locationId))
  }

  const prepareLocation = useCallback((location: RemoteLocation) => {
    if (!Object.hasOwn(cache, treeKey(location.id, ''))) {
      setLoadingKeys((current) => new Set(current).add(treeKey(location.id, '')))
    }
  }, [cache])

  const isActiveCacheReady =
    activeCacheIdentity !== null && hydratedCacheIdentity === activeCacheIdentity
  const rootKey = activeLocationId ? treeKey(activeLocationId, '') : ''
  const hasRootCache = isActiveCacheReady && Object.hasOwn(cache, rootKey)
  const rootIsLoading =
    Boolean(activeLocation) && (!isActiveCacheReady || effectiveLoadingKeys.has(rootKey))

  return {
    cache,
    expanded,
    loadingKeys,
    pathErrors,
    visibleEntries,
    activeCacheIdentity,
    isActiveCacheReady,
    hasRootCache,
    rootIsLoading,
    toggleDirectory,
    refreshEntry,
    clearLocationCache,
    prepareLocation,
  }
}
