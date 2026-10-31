import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  History,
  LoaderCircle,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { requestFileComparison, requestFileHistory } from '../api/remote'
import { fileIconUrl } from '../fileIcons'
import { formatModifiedAt } from '../lib/format'
import {
  formatRevisionPath,
  isSameRevisionPath,
  repositoryRelativePath,
} from '../lib/revisionPath'
import type {
  FileComparison,
  FileHistory as FileHistoryData,
  RemoteLocation,
  RevisionFileChange,
  TreeRow,
} from '../types/remote'
import { RevisionDiff } from './RevisionDiff'

type FileHistoryProps = {
  location: RemoteLocation
  entry: TreeRow
  revision?: number
  selectedFilePath?: string
  onCanonicalizeSelection: (revision: number, filePath?: string) => void
  onClose: () => void
  onSelectFile: (revision: number, filePath?: string) => void
}

type SelectedFile = {
  file: RevisionFileChange
  revision: number
  repositoryPath: string
}

const actionLabels: Record<RevisionFileChange['action'], string> = {
  A: '新增',
  M: '修改',
  D: '删除',
  R: '替换',
}

function fileName(path: string) {
  return path.split('/').pop() || path
}

function chooseRevisionFile(
  revision: FileHistoryData['entries'][number],
  entryPath: string,
  baseUrl: string,
  preferredPath?: string,
) {
  const files = revision.files.filter(
    (file) => file.kind === 'file' && file.action !== 'D',
  )
  if (preferredPath) {
    const preferred = files.find(
      (file) => repositoryRelativePath(file.path, baseUrl) === preferredPath,
    )
    if (preferred) return preferred
  }

  return (
    files.find((file) => isSameRevisionPath(file.path, entryPath, baseUrl)) ??
    files[0]
  )
}

export function FileHistory({
  location,
  entry,
  revision,
  selectedFilePath,
  onCanonicalizeSelection,
  onClose,
  onSelectFile,
}: FileHistoryProps) {
  const initialRevision = useRef(revision)
  const [history, setHistory] = useState<FileHistoryData | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [isHistoryLoading, setIsHistoryLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [historyRequestVersion, setHistoryRequestVersion] = useState(0)
  const [expandedRevisions, setExpandedRevisions] = useState<Set<number>>(
    new Set(),
  )
  const [comparisonState, setComparisonState] = useState<{
    key: string
    comparison?: FileComparison
    error?: string
  } | null>(null)
  const [fileRequestVersion, setFileRequestVersion] = useState(0)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  useEffect(() => {
    let cancelled = false

    void requestFileHistory(location, entry.path)
      .then((result) => {
        if (cancelled) return
        setHistory(result)
        const selectedRevision =
          (initialRevision.current &&
            result.entries.find(
              (item) => item.revision === initialRevision.current,
            )) ||
          result.entries[0]
        if (selectedRevision) {
          setExpandedRevisions((current) =>
            new Set(current).add(selectedRevision.revision),
          )
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setHistoryError(
            caught instanceof Error ? caught.message : '无法读取文件历史',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsHistoryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [entry.path, historyRequestVersion, location])

  const selectedRevisionEntry = useMemo(
    () =>
      revision
        ? history?.entries.find((item) => item.revision === revision)
        : undefined,
    [history, revision],
  )

  const selectedFile = useMemo<SelectedFile | null>(() => {
    if (!selectedRevisionEntry || !selectedFilePath) return null

    const file = selectedRevisionEntry.files.find((item) => {
      if (item.kind !== 'file' || item.action === 'D') return false
      return (
        repositoryRelativePath(item.path, location.url) === selectedFilePath
      )
    })
    if (!file) return null

    return {
      file,
      revision: selectedRevisionEntry.revision,
      repositoryPath: repositoryRelativePath(file.path, location.url),
    }
  }, [location.url, selectedFilePath, selectedRevisionEntry])

  const oldestRevision = history?.entries.at(-1)?.revision
  const shouldLoadOlderForRevision = Boolean(
    revision &&
      history?.hasMore &&
      oldestRevision &&
      revision < oldestRevision &&
      !selectedRevisionEntry,
  )
  const isLocatingRevision =
    shouldLoadOlderForRevision &&
    Boolean(history?.hasMore) &&
    !loadMoreError

  const comparisonRequestKey = selectedFile
    ? `${location.id}:${location.url}:${location.username}:${selectedFile.repositoryPath}:${selectedFile.revision}:${fileRequestVersion}`
    : ''
  const currentComparisonState =
    comparisonState?.key === comparisonRequestKey ? comparisonState : null
  const comparison = currentComparisonState?.comparison ?? null
  const fileError = currentComparisonState?.error ?? null
  const isFileLoading = Boolean(selectedFile && !currentComparisonState)

  useEffect(() => {
    if (!selectedFile) {
      return
    }

    let cancelled = false
    const requestKey = comparisonRequestKey

    void requestFileComparison(
      location,
      selectedFile.repositoryPath,
      selectedFile.revision,
    )
      .then((result) => {
        if (!cancelled) setComparisonState({ key: requestKey, comparison: result })
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setComparisonState({
            key: requestKey,
            error:
              caught instanceof Error
                ? caught.message
                : '无法读取选中版本与上一版本的差异',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [comparisonRequestKey, location, selectedFile])

  const retryHistory = () => {
    setHistory(null)
    setHistoryError(null)
    setIsHistoryLoading(true)
    setHistoryRequestVersion((value) => value + 1)
  }

  const toggleRevision = (revision: number) => {
    setExpandedRevisions((current) => {
      const next = new Set(current)
      if (next.has(revision)) next.delete(revision)
      else next.add(revision)
      return next
    })
  }

  const selectRevision = (revisionEntry: FileHistoryData['entries'][number]) => {
    if (revisionEntry.revision === revision) {
      toggleRevision(revisionEntry.revision)
      return
    }

    setExpandedRevisions((current) =>
      new Set(current).add(revisionEntry.revision),
    )
    const file = chooseRevisionFile(
      revisionEntry,
      entry.path,
      location.url,
      selectedFilePath,
    )
    onSelectFile(
      revisionEntry.revision,
      file ? repositoryRelativePath(file.path, location.url) : undefined,
    )
  }

  const openFile = (file: RevisionFileChange, revision: number) => {
    if (file.action === 'D') return
    setExpandedRevisions((current) => new Set(current).add(revision))
    onSelectFile(
      revision,
      repositoryRelativePath(file.path, location.url),
    )
  }

  const retryFile = () => {
    setFileRequestVersion((value) => value + 1)
  }

  const loadMore = useCallback(async () => {
    const lastRevision = history?.entries.at(-1)?.revision
    if (!lastRevision || !history.hasMore || isLoadingMore) return

    setIsLoadingMore(true)
    try {
      const next = await requestFileHistory(location, entry.path, lastRevision)
      setHistory((current) => {
        if (!current) return next
        const knownRevisions = new Set(
          current.entries.map((item) => item.revision),
        )
        return {
          ...next,
          entries: [
            ...current.entries,
            ...next.entries.filter(
              (item) => !knownRevisions.has(item.revision),
            ),
          ],
        }
      })
      if (revision && next.entries.some((item) => item.revision === revision)) {
        setExpandedRevisions((current) => new Set(current).add(revision))
      }
      setLoadMoreError(null)
    } catch (caught) {
      setLoadMoreError(
        caught instanceof Error ? caught.message : '无法加载更早的历史',
      )
    } finally {
      setIsLoadingMore(false)
    }
  }, [entry.path, history, isLoadingMore, location, revision])

  useEffect(() => {
    if (
      isHistoryLoading ||
      !shouldLoadOlderForRevision ||
      isLoadingMore ||
      loadMoreError
    ) {
      return
    }
    // URL-selected revisions may live beyond the initially loaded history page.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadMore()
  }, [
    isHistoryLoading,
    isLoadingMore,
    loadMore,
    loadMoreError,
    shouldLoadOlderForRevision,
  ])

  useEffect(() => {
    if (isHistoryLoading || !history?.entries.length) return

    const targetRevision =
      (revision &&
        history.entries.find((item) => item.revision === revision)) ||
      (shouldLoadOlderForRevision ? undefined : history.entries[0])
    if (!targetRevision) return

    const targetFile = chooseRevisionFile(
      targetRevision,
      entry.path,
      location.url,
      selectedFilePath,
    )
    const targetFilePath = targetFile
      ? repositoryRelativePath(targetFile.path, location.url)
      : undefined

    if (
      targetRevision.revision !== revision ||
      targetFilePath !== selectedFilePath
    ) {
      onCanonicalizeSelection(targetRevision.revision, targetFilePath)
    }
  }, [
    entry.path,
    history,
    isHistoryLoading,
    location.url,
    onCanonicalizeSelection,
    revision,
    selectedFilePath,
    shouldLoadOlderForRevision,
  ])

  const selectedName = selectedFile ? fileName(selectedFile.file.path) : ''
  const entryDisplayPath = formatRevisionPath(entry.path, location.url)

  return (
    <section
      className="history-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-title"
    >
      <header className="history-page-header">
        <div className="history-title">
          <span className="history-title-icon">
            <History size={18} />
          </span>
          <div>
            <p className="eyebrow">FILE HISTORY</p>
            <h2 id="history-title" title={entry.path}>
              {entry.name}
            </h2>
          </div>
          <span
            className="history-path"
            title={repositoryRelativePath(entry.path, location.url)}
          >
            {entryDisplayPath}
          </span>
        </div>
        <button
          className="comparison-close"
          type="button"
          onClick={onClose}
          aria-label="关闭文件历史"
          title="关闭"
        >
          <X size={19} />
        </button>
      </header>

      <div className="history-layout">
        <aside className="history-panel" aria-label="文件改动历史">
          <div className="history-panel-head">
            <div>
              <strong>改动历史</strong>
              <span>
                {history ? `${history.entries.length} 个修订版本` : '读取中'}
              </span>
            </div>
            <span className="history-panel-source">{location.name}</span>
          </div>

          {isHistoryLoading ? (
            <div className="history-panel-state">
              <LoaderCircle size={17} className="spin" />
              正在读取 SVN 历史…
            </div>
          ) : historyError ? (
            <div className="history-panel-state history-panel-error">
              <span>{historyError}</span>
              <button type="button" onClick={retryHistory}>
                重新加载
              </button>
            </div>
          ) : history?.entries.length ? (
            <div className="history-revision-list">
              {history.entries.map((revision) => {
                const changedFiles = revision.files.filter(
                  (file) => file.kind === 'file',
                )
                const isExpanded = expandedRevisions.has(revision.revision)

                return (
                  <div
                    key={revision.revision}
                    className={`history-revision ${isExpanded ? 'is-expanded' : ''}`}
                  >
                    <button
                      className="history-revision-summary"
                      type="button"
                      onClick={() => selectRevision(revision)}
                      aria-expanded={isExpanded}
                    >
                      <span className="history-revision-chevron">
                        {isExpanded ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                      </span>
                      <span className="history-revision-copy">
                        <span className="history-revision-line">
                          <code>r{revision.revision}</code>
                          <strong>{revision.author || '未知作者'}</strong>
                          <span>{formatModifiedAt(revision.modifiedAt)}</span>
                          <span className="history-file-count">
                            {changedFiles.length} 个文件
                          </span>
                        </span>
                        <span
                          className={`history-message ${revision.message ? '' : 'is-empty'}`}
                        >
                          {revision.message || '无提交说明'}
                        </span>
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="history-changed-files">
                        {changedFiles.map((file) => {
                          const isSelected =
                            selectedFile?.file.path === file.path &&
                            selectedFile.revision === revision.revision
                          const isDeleted = file.action === 'D'
                          const iconUrl = fileIconUrl(fileName(file.path))
                          const displayPath = formatRevisionPath(
                            file.path,
                            location.url,
                          )
                          const repositoryPath = repositoryRelativePath(
                            file.path,
                            location.url,
                          )

                          return (
                            <button
                              key={file.path}
                              className={`history-file ${isSelected ? 'is-selected' : ''}`}
                              type="button"
                              onClick={() => openFile(file, revision.revision)}
                              disabled={isDeleted}
                              title={
                                isDeleted
                                  ? `${repositoryPath} 在此版本中已删除`
                                  : repositoryPath
                              }
                            >
                              {iconUrl && (
                                <img
                                  src={iconUrl}
                                  alt=""
                                  aria-hidden="true"
                                />
                              )}
                              <span className="history-file-name">
                                {displayPath}
                              </span>
                              <span
                                className={`history-action history-action-${file.action}`}
                              >
                                {actionLabels[file.action]}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}

              {history.hasMore && (
                <div className="history-load-more">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore && <LoaderCircle size={13} className="spin" />}
                    {isLocatingRevision
                      ? `正在定位 r${revision}…`
                      : isLoadingMore
                        ? '正在加载…'
                        : '加载更早历史'}
                  </button>
                  {loadMoreError && <span>{loadMoreError}</span>}
                </div>
              )}
            </div>
          ) : (
            <div className="history-panel-state">该文件没有可显示的历史记录。</div>
          )}
        </aside>

        <section className="history-code-panel" aria-label="文件代码">
          {selectedFile ? (
            <>
              <div className="history-code-head">
                <span className="history-code-icon">
                  <FileCode2 size={15} />
                </span>
                <div>
                  <strong>{selectedName}</strong>
                  <span
                    title={repositoryRelativePath(
                      selectedFile.file.path,
                      location.url,
                    )}
                  >
                    {formatRevisionPath(selectedFile.file.path, location.url)}
                  </span>
                </div>
                <code>r{selectedFile.revision}</code>
              </div>
              <div className="history-code-body">
                {isFileLoading ? (
                  <div className="history-code-state">
                    <LoaderCircle size={18} className="spin" />
                    正在读取 r{selectedFile.revision} 与上一版本的差异…
                  </div>
                ) : fileError ? (
                  <div className="history-code-state history-panel-error">
                    <span>{fileError}</span>
                    <button type="button" onClick={retryFile}>
                      重新加载
                    </button>
                  </div>
                ) : comparison ? (
                  <RevisionDiff
                    comparison={comparison}
                    path={selectedFile.file.path}
                  />
                ) : null}
              </div>
            </>
          ) : isLocatingRevision ? (
            <div className="history-code-state">
              <LoaderCircle size={18} className="spin" />
              正在加载 r{revision} 的历史记录…
            </div>
          ) : (
            <div className="history-empty-code">
              <span className="history-empty-code-icon">
                <FileCode2 size={23} />
              </span>
              <strong>选择左侧的变更文件</strong>
              <p>展开任意修订版本，然后点击文件查看该版本与上一版本的差异。</p>
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
