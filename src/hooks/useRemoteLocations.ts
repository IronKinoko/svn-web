import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createStoredLocation,
  deleteStoredLocation,
  requestStoredLocations,
  updateStoredLocation,
  updateStoredLocationFavorites,
} from '../api/remote'
import {
  clearLegacyLocationStorage,
  readLegacyLocations,
} from '../lib/legacyLocations'
import type {
  FavoriteFolder,
  NewRemoteLocation,
  RemoteLocation,
} from '../types/remote'

export function useRemoteLocations() {
  const [locations, setLocations] = useState<RemoteLocation[]>([])
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeLocation = useMemo(
    () => locations.find((item) => item.id === activeLocationId),
    [activeLocationId, locations],
  )

  useEffect(() => {
    let cancelled = false

    const initialize = async () => {
      const legacy = readLegacyLocations()
      let backendLocations: RemoteLocation[] = []
      let loadError: string | null = null

      try {
        backendLocations = await requestStoredLocations()
      } catch (caught) {
        loadError = caught instanceof Error ? caught.message : '无法读取后端地址记录'
      }

      if (!legacy.migrated) {
        try {
          const currentLocations = new Map(
            backendLocations.map((location) => [location.id, location]),
          )
          for (const location of legacy.stored) {
            const existing = currentLocations.get(location.id)
            if (existing) {
              if (
                (!existing.username && location.username) ||
                (!existing.hasPassword && location.password)
              ) {
                const updated = await updateStoredLocation({
                  ...existing,
                  username: existing.username || location.username,
                  ...(existing.hasPassword || !location.password
                    ? {}
                    : { password: location.password }),
                })
                currentLocations.set(updated.id, updated)
              }
            } else {
              const created = await createStoredLocation(location)
              currentLocations.set(created.id, created)
            }
          }
          backendLocations = [...currentLocations.values()]
          clearLegacyLocationStorage()
        } catch (caught) {
          loadError = caught instanceof Error
            ? caught.message
            : '无法迁移浏览器的地址记录到后端'
        }
      } else {
        clearLegacyLocationStorage()
      }

      if (cancelled) return
      setLocations(backendLocations)
      setActiveLocationId(backendLocations[0]?.id ?? null)
      setReady(true)
      if (loadError) setError(loadError)
    }

    void initialize()
    return () => {
      cancelled = true
    }
  }, [])

  const createLocation = async (location: NewRemoteLocation) => {
    const created = await createStoredLocation(location)
    setLocations((current) => [...current, created])
    setActiveLocationId(created.id)
    return created
  }

  const saveLocation = async (location: RemoteLocation) => {
    const saved = await updateStoredLocation(location)
    setLocations((current) =>
      current.map((item) => (item.id === saved.id ? saved : item)),
    )
    setActiveLocationId(saved.id)
    return saved
  }

  const removeLocation = async (location: RemoteLocation) => {
    await deleteStoredLocation(location.id)
    const remaining = locations.filter((item) => item.id !== location.id)
    setLocations(remaining)
    if (activeLocationId === location.id) {
      setActiveLocationId(remaining[0]?.id ?? null)
    }
    return remaining
  }

  const saveFavorites = async (
    location: RemoteLocation,
    favorites: FavoriteFolder[],
  ) => {
    const saved = await updateStoredLocationFavorites(location.id, favorites)
    setLocations((current) =>
      current.map((item) => (item.id === saved.id ? saved : item)),
    )
    return saved
  }

  const selectLocation = useCallback((location: RemoteLocation) => {
    setActiveLocationId(location.id)
    setError(null)
  }, [])

  return {
    locations,
    activeLocation,
    activeLocationId,
    ready,
    error,
    setError,
    createLocation,
    saveLocation,
    saveFavorites,
    removeLocation,
    selectLocation,
  }
}
