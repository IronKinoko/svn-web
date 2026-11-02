import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { ErrorBanner } from './components/ErrorBanner'
import { Sidebar } from './components/Sidebar'
import { TreePanel } from './components/TreePanel'
import { WelcomePanel } from './components/WelcomePanel'
import { useAppRoute } from './hooks/useAppRoute'
import { useLocationForm } from './hooks/useLocationForm'
import { useRemoteLocations } from './hooks/useRemoteLocations'
import { useRemoteTree } from './hooks/useRemoteTree'
import type {
  FavoriteFolder,
  RemoteLocation,
  TreeRow,
} from './types/remote'
import './App.css'

const FileHistory = lazy(async () => {
  const module = await import('./components/FileHistory')
  return { default: module.FileHistory }
})

function fileName(path: string) {
  return path.split('/').pop() || path
}

function favoriteRootForPath(location: RemoteLocation, path: string) {
  return (location.favorites ?? [])
    .filter(
      (favorite) =>
        path === favorite.path || path.startsWith(`${favorite.path}/`),
    )
    .sort((left, right) => right.path.length - left.path.length)[0]?.path
}

function App() {
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const { route, navigate, isCanonical } = useAppRoute()
  const locationsState = useRemoteLocations()
  const { setError, selectLocation: selectActiveLocation } = locationsState
  const reportError = useCallback((message: string | null) => setError(message), [setError])
  const tree = useRemoteTree({
    activeLocation: locationsState.activeLocation,
    activeLocationId: locationsState.activeLocationId,
    reportError,
  })
  const {
    browseDirectoryRoot,
    showLocationRoot,
  } = tree
  const locationForm = useLocationForm({
    locations: locationsState.locations,
    createLocation: locationsState.createLocation,
    saveLocation: locationsState.saveLocation,
    clearLocationCache: tree.clearLocationCache,
    prepareLocation: tree.prepareLocation,
    reportError,
    onSaved: (location) => {
      if (route.locationId !== location.id) {
        navigate({ page: 'remote', locationId: location.id })
      }
    },
  })

  const removeLocation = async (location: RemoteLocation) => {
    try {
      await locationsState.removeLocation(location)
      tree.clearLocationCache(location.id)
    } catch (caught) {
      reportError(caught instanceof Error ? caught.message : '无法删除后端地址记录')
    }
  }

  const selectLocation = (location: RemoteLocation) => {
    navigate({ page: 'remote', locationId: location.id })
  }

  const saveFavorites = async (
    location: RemoteLocation,
    favorites: FavoriteFolder[],
  ) => {
    try {
      const saved = await locationsState.saveFavorites(location, favorites)
      reportError(null)
      return saved
    } catch (caught) {
      reportError(caught instanceof Error ? caught.message : '无法保存收藏目录')
      return null
    }
  }

  const toggleFavorite = async (entry: TreeRow) => {
    const location = locationsState.activeLocation
    if (!location || entry.kind !== 'directory') return

    const current = location.favorites ?? []
    const isFavorite = current.some((favorite) => favorite.path === entry.path)
    const next = isFavorite
      ? current.filter((favorite) => favorite.path !== entry.path)
      : [
          ...current,
          {
            path: entry.path,
            name: entry.name,
            ...(entry.author ? { author: entry.author } : {}),
            ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}),
          },
        ]
    const saved = await saveFavorites(location, next)
    if (
      saved &&
      isFavorite &&
      route.page === 'remote' &&
      route.locationId === location.id &&
      route.path === entry.path
    ) {
      navigate({ page: 'remote', locationId: location.id }, { replace: true })
    }
  }

  const selectFavorite = (
    location: RemoteLocation,
    favorite: FavoriteFolder,
  ) => {
    navigate({
      page: 'remote',
      locationId: location.id,
      path: favorite.path,
    })
  }

  const removeFavorite = async (
    location: RemoteLocation,
    favorite: FavoriteFolder,
  ) => {
    const next = (location.favorites ?? []).filter(
      (item) => item.path !== favorite.path,
    )
    const saved = await saveFavorites(location, next)
    if (
      saved &&
      route.page === 'remote' &&
      route.locationId === location.id &&
      route.path === favorite.path
    ) {
      navigate({ page: 'remote', locationId: location.id }, { replace: true })
    }
  }

  const openFileHistory = (entry: TreeRow) => {
    if (!locationsState.activeLocation) return
    navigate({
      page: 'history',
      locationId: locationsState.activeLocation.id,
      path: entry.path,
      kind: entry.kind,
      ...(route.extraSearch ? { extraSearch: route.extraSearch } : {}),
    })
  }

  const routedRootPath = useMemo(() => {
    const location = locationsState.activeLocation
    if (!location || route.locationId !== location.id) return ''
    if (route.page === 'remote') return route.path ?? ''
    return favoriteRootForPath(location, route.path) ?? ''
  }, [locationsState.activeLocation, route])

  const closeFileHistory = useCallback(() => {
    if (!locationsState.activeLocation) {
      navigate({ page: 'remote' }, { replace: true })
      return
    }
    navigate({
      page: 'remote',
      locationId: locationsState.activeLocation.id,
      ...(routedRootPath ? { path: routedRootPath } : {}),
    }, { replace: true })
  }, [locationsState.activeLocation, navigate, routedRootPath])

  const selectHistoryFile = useCallback(
    (revision: number, filePath?: string) => {
      if (route.page !== 'history') return
      navigate({
        ...route,
        revision,
        ...(filePath ? { filePath } : { filePath: undefined }),
      })
    },
    [navigate, route],
  )

  const canonicalizeHistorySelection = useCallback(
    (revision: number, filePath?: string) => {
      if (route.page !== 'history') return
      navigate(
        {
          ...route,
          revision,
          ...(filePath ? { filePath } : { filePath: undefined }),
        },
        { replace: true },
      )
    },
    [navigate, route],
  )

  const historyEntry = useMemo<TreeRow | null>(() => {
    const location = locationsState.activeLocation
    if (
      route.page !== 'history' ||
      !location ||
      route.locationId !== location.id
    ) {
      return null
    }
    return {
      name: fileName(route.path),
      path: route.path,
      kind: route.kind === 'directory' ? 'directory' : 'file',
      depth: 0,
    }
  }, [locationsState.activeLocation, route])

  const favoritePaths = useMemo(
    () =>
      new Set(
        (locationsState.activeLocation?.favorites ?? []).map(
          (favorite) => favorite.path,
        ),
      ),
    [locationsState.activeLocation?.favorites],
  )

  useEffect(() => {
    if (!copyStatus) return
    const timeout = window.setTimeout(() => setCopyStatus(null), 2200)
    return () => window.clearTimeout(timeout)
  }, [copyStatus])

  useEffect(() => {
    if (!locationsState.ready) return

    if (!locationsState.locations.length) {
      if (route.locationId || route.page === 'history') {
        navigate({ page: 'remote' }, { replace: true })
      }
      return
    }

    const selectedLocation = route.locationId
      ? locationsState.locations.find(
          (location) => location.id === route.locationId,
        )
      : locationsState.locations[0]

    if (!selectedLocation) {
      navigate(
        {
          page: 'remote',
          locationId: locationsState.locations[0]!.id,
        },
        { replace: true },
      )
      return
    }

    if (locationsState.activeLocationId !== selectedLocation.id) {
      selectActiveLocation(selectedLocation)
    }
    if (!route.locationId) {
      navigate(
        { page: 'remote', locationId: selectedLocation.id },
        { replace: true },
      )
    } else if (!isCanonical) {
      navigate(route, { replace: true })
    }
  }, [
    locationsState.locations,
    locationsState.activeLocationId,
    locationsState.ready,
    isCanonical,
    navigate,
    route,
    route.locationId,
    route.page,
    selectActiveLocation,
  ])

  useEffect(() => {
    const location = locationsState.activeLocation
    if (
      !locationsState.ready ||
      !location ||
      route.locationId !== location.id
    ) {
      return
    }
    if (routedRootPath) {
      browseDirectoryRoot(location, routedRootPath)
    } else {
      showLocationRoot(location)
    }
  }, [
    locationsState.activeLocation,
    locationsState.ready,
    route.locationId,
    routedRootPath,
    browseDirectoryRoot,
    showLocationRoot,
  ])

  useEffect(() => {
    const location = locationsState.activeLocation
    if (!location) {
      document.title = 'SVN Web'
      return
    }
    document.title =
      route.page === 'history'
        ? `${fileName(route.path)} · 改动历史`
        : `${location.name} · SVN Web`
  }, [locationsState.activeLocation, route])

  const locationsAreLoading =
    !locationsState.ready &&
    (locationsState.locations.length === 0 || Boolean(locationsState.error))

  return (
    <main className="app-shell">
      <div className="workspace-layout">
        <Sidebar
          locations={locationsState.locations}
          activeLocationId={locationsState.activeLocationId}
          activeFavoritePath={routedRootPath}
          isLoading={locationsAreLoading}
          formOpen={locationForm.isOpen}
          editingLocationId={locationForm.editingLocationId}
          draft={locationForm.draft}
          onSelect={selectLocation}
          onSelectFavorite={selectFavorite}
          onRemoveFavorite={(location, favorite) => {
            void removeFavorite(location, favorite)
          }}
          onEdit={locationForm.openEdit}
          onRemove={(location) => void removeLocation(location)}
          onOpenAdd={locationForm.openAdd}
          onCloseForm={locationForm.close}
          onDraftChange={locationForm.updateDraft}
          onSubmit={locationForm.submit}
        />

        <section className="content">
          {locationsState.error && (
            <ErrorBanner
              message={locationsState.error}
              onDismiss={() => reportError(null)}
            />
          )}

          {locationsState.activeLocation ? (
            <TreePanel
              locationId={locationsState.activeLocation.id}
              baseUrl={locationsState.activeLocation.url}
              entries={tree.visibleEntries}
              hasRootCache={tree.hasRootCache}
              isLoading={tree.rootIsLoading}
              cacheReady={tree.isActiveCacheReady}
              hasError={Boolean(locationsState.error)}
              expanded={tree.expanded}
              favoritePaths={favoritePaths}
              loadingKeys={tree.loadingKeys}
              onCopyStatus={setCopyStatus}
              onHistory={openFileHistory}
              onRefreshEntry={tree.refreshEntry}
              onToggleFavorite={(entry) => {
                void toggleFavorite(entry)
              }}
              onToggle={tree.toggleDirectory}
            />
          ) : (
            <WelcomePanel onAddLocation={locationForm.openAdd} />
          )}

          {copyStatus && (
            <div className="copy-toast" role="status">{copyStatus}</div>
          )}
        </section>
      </div>

      {locationsState.activeLocation &&
        route.page === 'history' &&
        historyEntry && (
          <Suspense
            fallback={
              <div className="comparison-page">
                <div className="comparison-state">正在打开改动历史…</div>
              </div>
            }
          >
            <FileHistory
              key={`${locationsState.activeLocation.id}:${historyEntry.path}`}
              location={locationsState.activeLocation}
              entry={historyEntry}
              revision={route.revision}
              selectedFilePath={route.filePath}
              onCanonicalizeSelection={canonicalizeHistorySelection}
              onClose={closeFileHistory}
              onSelectFile={selectHistoryFile}
            />
          </Suspense>
        )}
    </main>
  )
}

export default App
