import { useCallback, useEffect, useState } from 'react'
import { ErrorBanner } from './components/ErrorBanner'
import { Sidebar } from './components/Sidebar'
import { TreePanel } from './components/TreePanel'
import { WelcomePanel } from './components/WelcomePanel'
import { useLocationForm } from './hooks/useLocationForm'
import { useRemoteLocations } from './hooks/useRemoteLocations'
import { useRemoteTree } from './hooks/useRemoteTree'
import type { RemoteLocation } from './types/remote'
import './App.css'

function App() {
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const locationsState = useRemoteLocations()
  const { setError } = locationsState
  const reportError = useCallback((message: string | null) => setError(message), [setError])
  const tree = useRemoteTree({
    activeLocation: locationsState.activeLocation,
    activeLocationId: locationsState.activeLocationId,
    reportError,
  })
  const locationForm = useLocationForm({
    locations: locationsState.locations,
    createLocation: locationsState.createLocation,
    saveLocation: locationsState.saveLocation,
    clearLocationCache: tree.clearLocationCache,
    prepareLocation: tree.prepareLocation,
    reportError,
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
    tree.prepareLocation(location)
    locationsState.selectLocation(location)
  }

  useEffect(() => {
    if (!copyStatus) return
    const timeout = window.setTimeout(() => setCopyStatus(null), 2200)
    return () => window.clearTimeout(timeout)
  }, [copyStatus])

  const locationsAreLoading =
    !locationsState.ready &&
    (locationsState.locations.length === 0 || Boolean(locationsState.error))

  return (
    <main className="app-shell">
      <div className="workspace-layout">
        <Sidebar
          locations={locationsState.locations}
          activeLocationId={locationsState.activeLocationId}
          isLoading={locationsAreLoading}
          formOpen={locationForm.isOpen}
          editingLocationId={locationForm.editingLocationId}
          draft={locationForm.draft}
          onSelect={selectLocation}
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
              loadingKeys={tree.loadingKeys}
              onCopyStatus={setCopyStatus}
              onRefreshEntry={tree.refreshEntry}
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
    </main>
  )
}

export default App
