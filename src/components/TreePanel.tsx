import { mdiFolderOpen } from '@mdi/js'
import { Icon } from '@mdi/react'
import { RefreshCw } from 'lucide-react'
import type { TreeRow } from '../types/remote'
import { TreeRow as TreeRowItem } from './TreeRow'

type TreePanelProps = {
  locationId: string
  baseUrl: string
  entries: TreeRow[]
  hasRootCache: boolean
  isLoading: boolean
  cacheReady: boolean
  hasError: boolean
  expanded: Set<string>
  loadingKeys: Set<string>
  onCopyStatus: (message: string | null) => void
  onRefreshEntry: (entry: TreeRow) => void
  onToggle: (entry: TreeRow) => void
}

export function TreePanel({
  locationId,
  baseUrl,
  entries,
  hasRootCache,
  isLoading,
  cacheReady,
  hasError,
  expanded,
  loadingKeys,
  onCopyStatus,
  onRefreshEntry,
  onToggle,
}: TreePanelProps) {
  return (
    <section className="tree-panel" aria-label="远程目录树">
      <div className="tree-column-head">
        <span>名称</span>
        <span>作者</span>
        <span>最后修改时间</span>
      </div>

      {isLoading && !hasRootCache ? (
        <div className="tree-loading">
          <RefreshCw size={15} className="spin" />
          {cacheReady ? '正在连接远程仓库…' : '正在恢复服务端目录缓存…'}
        </div>
      ) : hasError && !hasRootCache ? (
        <div className="tree-loading tree-load-error">
          无法读取仓库根目录。请检查地址、网络连接和 SVN 访问权限。
        </div>
      ) : entries.length ? (
        <div className="tree-list" role="tree" aria-label="远程仓库内容">
          {entries.map((entry) => {
            const entryKey = `${locationId}:${entry.path}`
            return (
              <TreeRowItem
                key={entryKey}
                entry={entry}
                baseUrl={baseUrl}
                isExpanded={expanded.has(entryKey)}
                isLoading={loadingKeys.has(entryKey)}
                onCopyStatus={onCopyStatus}
                onRefresh={(target) => void onRefreshEntry(target)}
                onToggle={onToggle}
              />
            )
          })}
        </div>
      ) : (
        <div className="empty-tree">
          <div className="empty-tree-mark">
            <Icon path={mdiFolderOpen} size={1.15} />
          </div>
          <h3>这个远程目录是空的</h3>
          <p>该地址下没有可显示的文件或子目录。</p>
        </div>
      )}
    </section>
  )
}
