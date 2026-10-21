import { Globe2, Pencil, Trash2 } from 'lucide-react'
import type { RemoteLocation } from '../types/remote'

type LocationItemProps = {
  location: RemoteLocation
  isActive: boolean
  onSelect: (location: RemoteLocation) => void
  onEdit: (location: RemoteLocation) => void
  onRemove: (location: RemoteLocation) => void
}

export function LocationItem({
  location,
  isActive,
  onSelect,
  onEdit,
  onRemove,
}: LocationItemProps) {
  return (
    <div className="location-item-wrap">
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
      <div className="location-actions">
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
  )
}
