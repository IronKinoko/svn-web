import {
  ChevronDown,
  ChevronRight,
  Copy,
  History as HistoryIcon,
  RefreshCw,
  Star,
} from 'lucide-react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fileIconUrl, folderIconUrl } from '../fileIcons'
import { copyText } from '../lib/clipboard'
import { formatModifiedAt, formatModifiedAtTitle } from '../lib/format'
import { buildRemoteEntryUrl } from '../lib/url'
import type { TreeRow as TreeRowData } from '../types/remote'

type TreeRowProps = {
  entry: TreeRowData
  baseUrl: string
  isExpanded: boolean
  isFavorite: boolean
  isLoading: boolean
  onCopyStatus: (message: string | null) => void
  onHistory: (entry: TreeRowData) => void
  onRefresh: (entry: TreeRowData) => void
  onToggleFavorite: (entry: TreeRowData) => void
  onToggle: (entry: TreeRowData) => void
}

type ContextMenuPosition = {
  x: number
  y: number
}

type ContextMenuItem = {
  key: string
  label: string
  icon: ReactNode
  onSelect: () => void | Promise<void>
  disabled?: boolean
}

export function TreeRow({
  entry,
  baseUrl,
  isExpanded,
  isFavorite,
  isLoading,
  onCopyStatus,
  onHistory,
  onRefresh,
  onToggleFavorite,
  onToggle,
}: TreeRowProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const isDirectory = entry.kind === 'directory'
  const iconUrl = isDirectory
    ? folderIconUrl(entry.name, isExpanded)
    : fileIconUrl(entry.name)

  const copyEntryUrl = async () => {
    try {
      await copyText(buildRemoteEntryUrl(baseUrl, entry.path))
      onCopyStatus('SVN 链接已复制')
    } catch (caught) {
      onCopyStatus(caught instanceof Error ? caught.message : '无法复制 SVN 链接')
    }
  }

  const openContextMenu = (x: number, y: number) => {
    setContextMenu({ x, y })
  }

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    openContextMenu(event.clientX, event.clientY)
  }

  const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return

    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      openContextMenu(
        bounds.left + Math.min(bounds.width - 12, 320),
        bounds.top + Math.min(bounds.height - 4, 34),
      )
      return
    }

    if (!isDirectory || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onToggle(entry)
  }

  const menuItems: ContextMenuItem[] = [
    ...(!isDirectory
      ? [
          {
            key: 'history',
            label: '查看改动历史',
            icon: <HistoryIcon size={14} />,
            onSelect: () => onHistory(entry),
          },
        ]
      : [
          {
            key: 'favorite',
            label: isFavorite ? '取消收藏此文件夹' : '收藏此文件夹',
            icon: (
              <Star
                size={14}
                fill={isFavorite ? 'currentColor' : 'none'}
              />
            ),
            onSelect: () => onToggleFavorite(entry),
          },
        ]),
    {
      key: 'copy',
      label: '复制 SVN 链接',
      icon: <Copy size={14} />,
      onSelect: copyEntryUrl,
    },
    {
      key: 'refresh',
      label: isLoading
        ? '正在刷新…'
        : isDirectory
          ? '刷新此节点及子节点'
          : '刷新此文件',
      icon: <RefreshCw size={14} className={isLoading ? 'spin' : ''} />,
      onSelect: () => onRefresh(entry),
      disabled: isLoading,
    },
  ]

  useEffect(() => {
    if (!contextMenu) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      setContextMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    const closeOnViewportChange = () => setContextMenu(null)

    window.addEventListener('pointerdown', closeOnOutsidePointer, true)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)

    const focusFrame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus()
    })

    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [contextMenu])

  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) return

    const edge = 8
    const bounds = menuRef.current.getBoundingClientRect()
    const left = Math.max(
      edge,
      Math.min(contextMenu.x, window.innerWidth - bounds.width - edge),
    )
    const top = Math.max(
      edge,
      Math.min(contextMenu.y, window.innerHeight - bounds.height - edge),
    )
    menuRef.current.style.left = `${left}px`
    menuRef.current.style.top = `${top}px`
  }, [contextMenu, isDirectory, isFavorite, isLoading])

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setContextMenu(null)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return

    event.preventDefault()
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    )
    if (!items.length) return

    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (activeIndex + 1) % items.length
            : (activeIndex - 1 + items.length) % items.length
    items[nextIndex]?.focus()
  }

  const runMenuItem = (item: ContextMenuItem) => {
    if (item.disabled) return
    setContextMenu(null)
    void Promise.resolve(item.onSelect())
  }

  return (
    <>
      <div
        className="tree-row"
        role="treeitem"
        aria-expanded={isDirectory ? isExpanded : undefined}
        aria-haspopup="menu"
        style={{ '--depth': entry.depth } as CSSProperties}
        onClick={isDirectory ? () => onToggle(entry) : undefined}
        onContextMenu={handleContextMenu}
        onKeyDown={handleRowKeyDown}
        tabIndex={0}
      >
        {isDirectory ? (
          <span className="tree-name tree-name-button">
            <span className="tree-chevron">
              {isLoading ? (
                <RefreshCw size={13} className="spin" />
              ) : isExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </span>
            {iconUrl && (
              <img
                className="tree-file-icon"
                src={iconUrl}
                alt=""
                aria-hidden="true"
              />
            )}
            {isFavorite && (
              <Star
                className="tree-favorite-mark"
                size={11}
                fill="currentColor"
                aria-label="已收藏"
              />
            )}
            <span>{entry.name}</span>
          </span>
        ) : (
          <span className="tree-name">
            <span className="tree-chevron" aria-hidden="true" />
            {iconUrl && (
              <img
                className="tree-file-icon"
                src={iconUrl}
                alt=""
                aria-hidden="true"
              />
            )}
            <span>{entry.name}</span>
          </span>
        )}
        <span className="tree-author" title={entry.author}>
          {entry.author || '—'}
        </span>
        <span className="modified-at" title={formatModifiedAtTitle(entry.modifiedAt)}>
          {formatModifiedAt(entry.modifiedAt)}
        </span>
      </div>

      {contextMenu &&
        createPortal(
          <div
            ref={menuRef}
            className="tree-context-menu"
            role="menu"
            aria-label={`${entry.name} 操作菜单`}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={handleMenuKeyDown}
          >
            {menuItems.map((item) => (
              <button
                key={item.key}
                className="tree-context-menu-item"
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => runMenuItem(item)}
              >
                <span className="tree-context-menu-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
