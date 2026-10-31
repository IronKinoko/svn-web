import { Globe2, Pencil, Trash2 } from 'lucide-react'
import type { FavoriteFolder, RemoteLocation } from '../types/remote'

type LocationItemProps = {
  location: RemoteLocation
  isActive: boolean
  activeFavoritePath: string
  onSelect: (location: RemoteLocation) => void
  onSelectFavorite: (location: RemoteLocation, favorite: FavoriteFolder) => void
  onRemoveFavorite: (
    location: RemoteLocation,
    favorite: FavoriteFolder,
  ) => void
  onEdit: (location: RemoteLocation) => void
  onRemove: (location: RemoteLocation) => void
}

export function LocationItem({
  location,
  isActive,
  activeFavoritePath,
  onSelect,
  onSelectFavorite,
  onRemoveFavorite,
  onEdit,
  onRemove,
}: LocationItemProps) {
  const favorites = location.favorites ?? []
  const hasActiveFavorite =
    isActive && favorites.some((favorite) => favorite.path === activeFavoritePath)
  const activeStateClass = hasActiveFavorite
    ? ' is-active has-active-favorite'
    : isActive
      ? ' is-active is-root-active'
      : ''

  return (
    <div className={`location-item-wrap${activeStateClass}`}>
      <div className="location-item-heading">
        <button
          className={`workspace-item${isActive ? ' is-active' : ''}`}
          onClick={() => onSelect(location)}
          type="button"
          title={location.url}
        >
          <span className="workspace-icon"><Globe2 size={17} /></span>
          <span className="workspace-copy">
            <span className="workspace-name">{location.name}</span>
            <span className="workspace-caption">{location.url}</span>
          </span>
        </button>
        <div
          className="location-actions"
          role="group"
          aria-label={`${location.name} 的操作`}
        >
          <button
            className="edit-location"
            type="button"
            aria-label={`编辑 ${location.name} 的地址和登录信息`}
            title="编辑地址和登录信息"
            onClick={() => onEdit(location)}
          >
            <Pencil size={14} />
          </button>
          <button
            className="remove-location"
            type="button"
            aria-label={`移除 ${location.name}`}
            title="移除地址"
            onClick={() => onRemove(location)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {favorites.length > 0 && (
        <div className="location-favorites" aria-label={`${location.name} 的收藏目录`}>
          {favorites.map((favorite) => (
            <div className="favorite-item-wrap" key={favorite.path}>
              <button
                className={`favorite-item${favorite.path === activeFavoritePath ? ' is-active' : ''}`}
                type="button"
                title={favorite.path}
                onClick={() => onSelectFavorite(location, favorite)}
              >
                <span className="favorite-item-name">{favorite.name}</span>
              </button>
              <button
                className="favorite-remove"
                type="button"
                aria-label={`移除收藏 ${favorite.name}`}
                title="移除收藏"
                onClick={() => onRemoveFavorite(location, favorite)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
