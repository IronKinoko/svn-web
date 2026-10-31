import { Database, Plus, RefreshCw } from 'lucide-react'
import type { FormEvent } from 'react'
import type {
  FavoriteFolder,
  LocationDraft,
  RemoteLocation,
} from '../types/remote'
import { LocationForm } from './LocationForm'
import { LocationItem } from './LocationItem'

type SidebarProps = {
  locations: RemoteLocation[]
  activeLocationId: string | null
  activeFavoritePath: string
  isLoading: boolean
  formOpen: boolean
  editingLocationId: string | null
  draft: LocationDraft
  onSelect: (location: RemoteLocation) => void
  onSelectFavorite: (location: RemoteLocation, favorite: FavoriteFolder) => void
  onRemoveFavorite: (
    location: RemoteLocation,
    favorite: FavoriteFolder,
  ) => void
  onEdit: (location: RemoteLocation) => void
  onRemove: (location: RemoteLocation) => void
  onOpenAdd: () => void
  onCloseForm: () => void
  onDraftChange: (field: keyof LocationDraft, value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function Sidebar({
  locations,
  activeLocationId,
  activeFavoritePath,
  isLoading,
  formOpen,
  editingLocationId,
  draft,
  onSelect,
  onSelectFavorite,
  onRemoveFavorite,
  onEdit,
  onRemove,
  onOpenAdd,
  onCloseForm,
  onDraftChange,
  onSubmit,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <div>
          <p className="eyebrow">SVN 资源</p>
          <h1>远程地址</h1>
        </div>
        <span className="count-pill">{locations.length}</span>
      </div>

      <nav className="workspace-list" aria-label="已保存的远程地址">
        {locations.length ? (
          locations.map((location) => (
            <LocationItem
              key={location.id}
              location={location}
              isActive={location.id === activeLocationId}
              activeFavoritePath={
                location.id === activeLocationId ? activeFavoritePath : ''
              }
              onSelect={onSelect}
              onSelectFavorite={onSelectFavorite}
              onRemoveFavorite={onRemoveFavorite}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))
        ) : (
          <div className="sidebar-message empty-sidebar">
            {isLoading ? (
              <>
                <RefreshCw size={17} className="spin" />
                <span>正在读取服务端地址记录…</span>
              </>
            ) : (
              <>
                <Database size={19} />
                <span>还没有保存的远程地址</span>
              </>
            )}
          </div>
        )}

        {formOpen ? (
          <LocationForm
            draft={draft}
            isEditing={Boolean(editingLocationId)}
            onChange={onDraftChange}
            onCancel={onCloseForm}
            onSubmit={onSubmit}
          />
        ) : (
          <button className="add-location" type="button" onClick={onOpenAdd}>
            <Plus size={15} />
            <span>添加远程地址</span>
          </button>
        )}
      </nav>

    </aside>
  )
}
