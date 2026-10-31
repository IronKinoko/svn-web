import { useState, type FormEvent } from 'react'
import {
  clearPersistentTreeCache,
} from '../api/remote'
import { inferLocationName, isSupportedRemoteUrl, normalizeRemoteUrl } from '../lib/url'
import type {
  LocationDraft,
  NewRemoteLocation,
  RemoteLocation,
} from '../types/remote'

type LocationFormInput = {
  locations: RemoteLocation[]
  createLocation: (location: NewRemoteLocation) => Promise<RemoteLocation>
  saveLocation: (location: RemoteLocation) => Promise<RemoteLocation>
  clearLocationCache: (locationId: string) => void
  prepareLocation: (location: RemoteLocation) => void
  reportError: (message: string | null) => void
  onSaved: (location: RemoteLocation) => void
}

const emptyDraft: LocationDraft = {
  name: '',
  url: '',
  username: '',
  password: '',
}

export function useLocationForm({
  locations,
  createLocation,
  saveLocation,
  clearLocationCache,
  prepareLocation,
  reportError,
  onSaved,
}: LocationFormInput) {
  const [isOpen, setIsOpen] = useState(false)
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)
  const [draft, setDraft] = useState<LocationDraft>(emptyDraft)

  const updateDraft = (field: keyof LocationDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const close = () => {
    setIsOpen(false)
    setEditingLocationId(null)
    setDraft(emptyDraft)
  }

  const openAdd = () => {
    setEditingLocationId(null)
    setDraft(emptyDraft)
    setIsOpen(true)
    reportError(null)
  }

  const openEdit = (location: RemoteLocation) => {
    setEditingLocationId(location.id)
    setDraft({
      name: location.name,
      url: location.url,
      username: location.username,
      password: '',
    })
    setIsOpen(true)
    reportError(null)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isSupportedRemoteUrl(draft.url)) {
      reportError('请输入有效的远程 SVN 地址（http、https、svn 或 svn+ssh）')
      return
    }

    const normalizedUrl = normalizeRemoteUrl(draft.url)
    const locationInput: NewRemoteLocation = {
      name: draft.name.trim() || inferLocationName(normalizedUrl),
      url: normalizedUrl,
      username: draft.username.trim(),
      ...(draft.password ? { password: draft.password } : {}),
    }

    if (editingLocationId) {
      const previousLocation = locations.find((item) => item.id === editingLocationId)
      const credentialsChanged = Boolean(
        previousLocation &&
          (previousLocation.url !== locationInput.url ||
            previousLocation.username !== locationInput.username ||
            (draft.password && draft.password !== locationInput.password)),
      )

      let savedLocation: RemoteLocation
      try {
        savedLocation = await saveLocation({
          id: editingLocationId,
          ...locationInput,
        })
      } catch (caught) {
        reportError(caught instanceof Error ? caught.message : '无法更新后端地址记录')
        return
      }

      if (credentialsChanged) {
        try {
          await clearPersistentTreeCache(savedLocation.id)
        } catch (caught) {
          reportError(caught instanceof Error ? caught.message : '无法清除旧地址缓存')
          return
        }
        clearLocationCache(savedLocation.id)
      }
      prepareLocation(savedLocation)
      onSaved(savedLocation)
    } else {
      let savedLocation: RemoteLocation
      try {
        savedLocation = await createLocation(locationInput)
      } catch (caught) {
        reportError(caught instanceof Error ? caught.message : '无法保存后端地址记录')
        return
      }
      prepareLocation(savedLocation)
      onSaved(savedLocation)
    }

    close()
    reportError(null)
  }

  return {
    isOpen,
    editingLocationId,
    draft,
    updateDraft,
    openAdd,
    openEdit,
    close,
    submit,
  }
}
