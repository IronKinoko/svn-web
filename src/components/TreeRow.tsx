import { Check, ChevronDown, ChevronRight, Copy, RefreshCw } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useState } from 'react'
import { fileIconUrl, folderIconUrl } from '../fileIcons'
import { copyText } from '../lib/clipboard'
import { formatModifiedAt, formatModifiedAtTitle } from '../lib/format'
import { buildRemoteEntryUrl } from '../lib/url'
import type { TreeRow as TreeRowData } from '../types/remote'

type TreeRowProps = {
  entry: TreeRowData
  baseUrl: string
  isExpanded: boolean
  isLoading: boolean
  onCopyStatus: (message: string | null) => void
  onRefresh: (entry: TreeRowData) => void
  onToggle: (entry: TreeRowData) => void
}

export function TreeRow({
  entry,
  baseUrl,
  isExpanded,
  isLoading,
  onCopyStatus,
  onRefresh,
  onToggle,
}: TreeRowProps) {
  const [copied, setCopied] = useState(false)
  const isDirectory = entry.kind === 'directory'
  const iconUrl = isDirectory
    ? folderIconUrl(entry.name, isExpanded)
    : fileIconUrl(entry.name)

  const copyEntryUrl = async () => {
    try {
      await copyText(buildRemoteEntryUrl(baseUrl, entry.path))
      setCopied(true)
      onCopyStatus('SVN 链接已复制')
      window.setTimeout(() => setCopied(false), 1400)
    } catch (caught) {
      onCopyStatus(caught instanceof Error ? caught.message : '无法复制 SVN 链接')
    }
  }

  return (
    <div
      className="tree-row"
      role="treeitem"
      aria-expanded={isDirectory ? isExpanded : undefined}
      style={{ '--depth': entry.depth } as CSSProperties}
      onClick={isDirectory ? () => onToggle(entry) : undefined}
      onKeyDown={
        isDirectory
          ? (event) => {
              if (event.target !== event.currentTarget) return
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onToggle(entry)
            }
          : undefined
      }
      tabIndex={isDirectory ? 0 : undefined}
    >
      {isDirectory ? (
        <span
          className="tree-name tree-name-button"
        >
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
      <div className="tree-row-actions">
        <button
          className="tree-row-action"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            void copyEntryUrl()
          }}
          aria-label={`复制 ${entry.name} 的 SVN 链接`}
          title="复制 SVN 链接"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <button
          className="tree-row-action"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onRefresh(entry)
          }}
          disabled={isLoading}
          aria-label={`刷新 ${entry.name} 及其子节点`}
          title={isDirectory ? '刷新此节点及子节点' : '刷新此节点'}
        >
          <RefreshCw size={13} className={isLoading ? 'spin' : ''} />
        </button>
      </div>
    </div>
  )
}
