import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  invalidatePersistentTreeSubtree,
  RemoteTreePathMissingError,
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
  removeTreeEntry,
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
  const [rootPaths, setRootPaths] = useState<Record<string, string>>({})
  const inFlightKeys = useRef(new Set<string>())
  const unavailableExpandedKeys = useRef(new Set<string>())

  const activeCacheIdentity = activeLocation
    ? cacheIdentityKey(activeLocation, activeLocation.username)
    : null
  const activeRootPath = activeLocationId
    ? rootPaths[activeLocationId] ?? ''
    : ''
  const loadingIdentity = activeLocation && !hydratedCacheIdentity
    ? activeCacheIdentity
    : null
  const effectiveLoadingKeys = loadingIdentity && activeLocationId
    ? new Set(loadingKeys).add(treeKey(activeLocationId, activeRootPath))
    : loadingKeys

  const forgetMissingDirectory = useCallback(
    async (location: RemoteLocation, path: string) => {
      const key = treeKey(location.id, path)
      const parentPath = path.split('/').slice(0, -1).join('/')
      const parentKey = treeKey(location.id, parentPath)
      const nextExpanded = removeTreeSubtreeFromSet(expanded, location.id, path)

      unavailableExpandedKeys.current.add(key)
      setExpanded(nextExpanded)
      setCache((current) =>
        removeTreeEntry(
          removeTreeSubtree(current, location.id, path),
          location.id,
          path,
        ),
      )
      setPathErrors((current) =>
        removeTreeSubtree(current, location.id, path),
      )
      setRootPaths((current) => {
        if (current[location.id] !== path) return current
        return { ...current, [location.id]: '' }
      })
      reportError(null)

      const expandedPaths = [...nextExpanded]
        .filter((expandedKey) =>
          expandedKey.startsWith(locationCachePrefix(location.id)),
        )
        .map((expandedKey) => expandedKey.slice(location.id.length + 1))
      void savePersistentExpandedPaths(
        location,
        location.username,
        expandedPaths,
      ).catch(() => undefined)
      void invalidatePersistentTreeSubtree(location, path).catch(
        () => undefined,
      )

      // Replace the stale parent listing so the deleted node disappears
      // immediately instead of returning on the next cache restore.
      try {
        const result = await requestRemoteTree(location, parentPath)
        setCache((current) => ({ ...current, [parentKey]: result.entries }))
      } catch {
        // The stale node was already removed from the in-memory tree.
      }
    },
    [expanded, reportError],
  )

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
    const key = treeKey(location.id, activeRootPath)
    if (Object.hasOwn(cache, key) || inFlightKeys.current.has(key)) return

    let cancelled = false
    inFlightKeys.current.add(key)
    setLoadingKeys((current) => new Set(current).add(key))
    requestRemoteTree(location, activeRootPath)
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
          if (caught instanceof RemoteTreePathMissingError) {
            void forgetMissingDirectory(activeLocation, activeRootPath)
            return
          }
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
  }, [
    activeLocation,
    activeCacheIdentity,
    activeRootPath,
    cache,
    forgetMissingDirectory,
    hydratedCacheIdentity,
    reportError,
  ])

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

    if (activeRootPath) {
      const favorite = activeLocation?.favorites?.find(
        (item) => item.path === activeRootPath,
      )
      rows.push({
        name: favorite?.name ?? activeRootPath.split('/').at(-1) ?? activeRootPath,
        path: activeRootPath,
        kind: 'directory',
        ...(favorite?.author ? { author: favorite.author } : {}),
        ...(favorite?.modifiedAt ? { modifiedAt: favorite.modifiedAt } : {}),
        depth: 0,
      })
      if (expanded.has(treeKey(activeLocationId, activeRootPath))) {
        visit(activeRootPath, 1)
      }
    } else {
      visit('', 0)
    }
    return rows
  }, [
    activeLocation,
    activeLocationId,
    activeCacheIdentity,
    activeRootPath,
    cache,
    expanded,
    hydratedCacheIdentity,
  ])

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
      if (caught instanceof RemoteTreePathMissingError) {
        await forgetMissingDirectory(location, path)
        return
      }
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
  }, [cache, forgetMissingDirectory, reportError])

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
    const stalePaths: string[] = []
    let nextPath: string | undefined
    for (const path of paths) {
      const key = treeKey(activeLocation.id, path)
      if (unavailableExpandedKeys.current.has(key)) continue
      const parentPath = path.split('/').slice(0, -1).join('/')
      const parentKey = treeKey(activeLocation.id, parentPath)
      if (!Object.hasOwn(cache, parentKey) || Object.hasOwn(cache, key)) continue
      if (isMissingExpandedDirectory(cache, activeLocation.id, path)) {
        unavailableExpandedKeys.current.add(key)
        stalePaths.push(path)
        continue
      }
      nextPath = path
      break
    }
    if (stalePaths.length) {
      let nextExpanded = expanded
      for (const path of stalePaths) {
        nextExpanded = removeTreeSubtreeFromSet(
          nextExpanded,
          activeLocation.id,
          path,
        )
      }
      // oxlint-disable-next-line react/set-state-in-effect
      setExpanded(nextExpanded)
      const expandedPaths = [...nextExpanded]
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(activeLocation.id.length + 1))
      void savePersistentExpandedPaths(
        activeLocation,
        activeLocation.username,
        expandedPaths,
      ).catch(() => undefined)
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
      if (caught instanceof RemoteTreePathMissingError) {
        await forgetMissingDirectory(location, entry.path)
        return
      }
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
    setRootPaths((current) => {
      if (!Object.hasOwn(current, locationId)) return current
      const next = { ...current }
      delete next[locationId]
      return next
    })
  }

  const prepareLocation = useCallback((location: RemoteLocation) => {
    const path = rootPaths[location.id] ?? ''
    if (!Object.hasOwn(cache, treeKey(location.id, path))) {
      setLoadingKeys((current) => new Set(current).add(treeKey(location.id, path)))
    }
  }, [cache, rootPaths])

  const browseDirectoryRoot = useCallback(
    (location: RemoteLocation, path: string) => {
      setRootPaths((current) => ({ ...current, [location.id]: path }))
      const key = treeKey(location.id, path)
      setExpanded((current) => new Set(current).add(key))
    },
    [],
  )

  const showLocationRoot = useCallback((location: RemoteLocation) => {
    setRootPaths((current) => ({ ...current, [location.id]: '' }))
  }, [])

  const showLocationRootIfCurrent = useCallback(
    (locationId: string, path: string) => {
      setRootPaths((current) => {
        if (current[locationId] !== path) return current
        return { ...current, [locationId]: '' }
      })
    },
    [],
  )

  const isActiveCacheReady =
    activeCacheIdentity !== null && hydratedCacheIdentity === activeCacheIdentity
  const rootKey = activeLocationId
    ? treeKey(activeLocationId, activeRootPath)
    : ''
  const hasRootCache = isActiveCacheReady && Object.hasOwn(cache, rootKey)
  const rootIsLoading =
    Boolean(activeLocation) && (!isActiveCacheReady || effectiveLoadingKeys.has(rootKey))

  return {
    cache,
    expanded,
    loadingKeys,
    pathErrors,
    visibleEntries,
    rootPath: activeRootPath,
    activeCacheIdentity,
    isActiveCacheReady,
    hasRootCache,
    rootIsLoading,
    toggleDirectory,
    refreshEntry,
    clearLocationCache,
    prepareLocation,
    browseDirectoryRoot,
    showLocationRoot,
    showLocationRootIfCurrent,
  }
}
