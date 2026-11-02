import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  List,
  ListTree,
  LoaderCircle,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { requestFileComparison, requestFileHistory } from '../api/remote'
import { fileIconUrl } from '../fileIcons'
import { formatModifiedAt } from '../lib/format'
import {
  formatRevisionPath,
  isSameRevisionPath,
  repositoryRelativePath,
} from '../lib/revisionPath'
import { prepareRevisionDiffComparison } from '../lib/revisionDiff'
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

type FileListView = 'tree' | 'list'

type ChangedFileTreeNode = {
  name: string
  path: string
  kind: 'directory' | 'file'
  file?: RevisionFileChange
  dir?: RevisionFileChange
  children: ChangedFileTreeNode[]
}

const FILE_LIST_VIEW_STORAGE_KEY = 'history-file-view'
// Chevron column plus gap, so same-depth file and folder icons share a column.
const HISTORY_TREE_INDENT = 19

function fileName(path: string) {
  return path.split('/').pop() || path
}

function treeIndent(depth: number) {
  return `${8 + depth * HISTORY_TREE_INDENT}px`
}

function readStoredFileListView(): FileListView {
  try {
    const storedView = window.localStorage.getItem(FILE_LIST_VIEW_STORAGE_KEY)
    return storedView === 'list' ? 'list' : 'tree'
  } catch {
    return 'tree'
  }
}

function buildChangedFileTree(
  items: RevisionFileChange[],
  baseUrl: string,
): ChangedFileTreeNode[] {
  const roots: ChangedFileTreeNode[] = []

  for (const item of items) {
    const segments = (
      formatRevisionPath(item.path, baseUrl) || fileName(item.path)
    )
      .split('/')
      .filter(Boolean)
    if (!segments.length) continue

    let siblings = roots
    let parentPath = ''

    segments.forEach((name, index) => {
      parentPath = parentPath ? `${parentPath}/${name}` : name
      const isLeaf = index === segments.length - 1
      const kind = isLeaf ? item.kind : 'directory'
      let node = siblings.find(
        (candidate) => candidate.name === name && candidate.kind === kind,
      )

      if (!node) {
        node = { name, path: parentPath, kind, children: [] }
        siblings.push(node)
      }

      if (kind === 'directory') {
        if (isLeaf) node.dir = item
        siblings = node.children
      } else {
        node.file = item
      }
    })
  }

  const sortNodes = (nodes: ChangedFileTreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    })
    nodes.forEach((node) => sortNodes(node.children))
  }
  sortNodes(roots)

  return roots
}

function chooseRevisionFile(
  revision: FileHistoryData['entries'][number],
  entryPath: string,
  baseUrl: string,
  preferredPath?: string,
  pickDefault = true,
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
  if (!pickDefault) return undefined

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
  const isDirectory = entry.kind === 'directory'
  const entrySubject = isDirectory ? '文件夹' : '文件'
  const initialRevision = useRef(revision)
  const [history, setHistory] = useState<FileHistoryData | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [isHistoryLoading, setIsHistoryLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [historyRequestVersion, setHistoryRequestVersion] = useState(0)
  const [expandedRevision, setExpandedRevision] = useState<number | null>(null)
  const [fileListView, setFileListView] =
    useState<FileListView>(readStoredFileListView)
  const [collapsedFileDirectories, setCollapsedFileDirectories] = useState<
    Set<string>
  >(new Set())
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
          setExpandedRevision(selectedRevision.revision)
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setHistoryError(
            caught instanceof Error ? caught.message : `无法读取${entrySubject}历史`,
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsHistoryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [entry.path, entrySubject, historyRequestVersion, location])

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
        if (!cancelled) {
          setComparisonState({
            key: requestKey,
            comparison: prepareRevisionDiffComparison(
              result,
              selectedFile.file.action,
            ),
          })
        }
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
    setExpandedRevision((current) => (current === revision ? null : revision))
  }

  const selectRevision = (revisionEntry: FileHistoryData['entries'][number]) => {
    if (revisionEntry.revision === revision) {
      toggleRevision(revisionEntry.revision)
      return
    }

    setExpandedRevision(revisionEntry.revision)
    const file = chooseRevisionFile(
      revisionEntry,
      entry.path,
      location.url,
      selectedFilePath,
      !isDirectory,
    )
    onSelectFile(
      revisionEntry.revision,
      file ? repositoryRelativePath(file.path, location.url) : undefined,
    )
  }

  const openFile = (file: RevisionFileChange, revision: number) => {
    if (file.action === 'D') return
    setExpandedRevision(revision)
    onSelectFile(
      revision,
      repositoryRelativePath(file.path, location.url),
    )
  }

  const chooseFileListView = (nextView: FileListView) => {
    setFileListView(nextView)
    try {
      window.localStorage.setItem(FILE_LIST_VIEW_STORAGE_KEY, nextView)
    } catch {
      // The selected view still applies when local storage is unavailable.
    }
  }

  const toggleFileDirectory = (revision: number, path: string) => {
    const key = `${revision}:${path}`
    setCollapsedFileDirectories((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const renderFileButton = (
    file: RevisionFileChange,
    revision: number,
    displayName: string,
    treeDepth?: number,
  ) => {
    const isSelected =
      selectedFile?.file.path === file.path &&
      selectedFile.revision === revision
    const isDeleted = file.action === 'D'
    const iconUrl = fileIconUrl(fileName(file.path))
    const repositoryPath = repositoryRelativePath(file.path, location.url)

    return (
      <button
        key={file.path}
        className={`history-file${treeDepth !== undefined ? ' history-tree-file' : ''}${isSelected ? ' is-selected' : ''}`}
        type="button"
        onClick={() => openFile(file, revision)}
        disabled={isDeleted}
        title={
          isDeleted
            ? `${repositoryPath} 在此版本中已删除`
            : repositoryPath
        }
        aria-current={isSelected ? 'true' : undefined}
        style={
          treeDepth === undefined
            ? undefined
            : { paddingInlineStart: treeIndent(treeDepth + 1) }
        }
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" aria-hidden="true" />
        ) : (
          <FileCode2 size={14} aria-hidden="true" />
        )}
        <span className="history-file-name">{displayName}</span>
        <span className={`history-action history-action-${file.action}`}>
          {actionLabels[file.action]}
        </span>
      </button>
    )
  }

  const renderDirectoryItem = (dir: RevisionFileChange) => {
    const repositoryPath = repositoryRelativePath(dir.path, location.url)
    return (
      <div
        key={dir.path}
        className="history-file history-directory"
        title={`${repositoryPath}（目录，无法查看文件差异）`}
        aria-disabled="true"
      >
        <Folder size={14} aria-hidden="true" />
        <span className="history-file-name">
          {formatRevisionPath(dir.path, location.url)}
        </span>
        <span className={`history-action history-action-${dir.action}`}>
          {actionLabels[dir.action]}
        </span>
      </div>
    )
  }

  const renderFileTree = (
    nodes: ChangedFileTreeNode[],
    revision: number,
    depth = 0,
  ): ReactNode => (
    <ul className="history-file-tree">
      {nodes.map((node) => {
        if (node.kind === 'directory') {
          const directoryKey = `${revision}:${node.path}`
          const isExpanded = !collapsedFileDirectories.has(directoryKey)

          return (
            <li className="history-file-tree-directory" key={node.path}>
              <button
                className="history-file-tree-directory-button"
                type="button"
                onClick={() => toggleFileDirectory(revision, node.path)}
                aria-expanded={isExpanded}
                style={{ paddingInlineStart: treeIndent(depth) }}
              >
                {isExpanded ? (
                  <ChevronDown size={13} aria-hidden="true" />
                ) : (
                  <ChevronRight size={13} aria-hidden="true" />
                )}
                {isExpanded ? (
                  <FolderOpen size={14} aria-hidden="true" />
                ) : (
                  <Folder size={14} aria-hidden="true" />
                )}
                <span>{node.name}</span>
                {node.dir && (
                  <span
                    className={`history-tree-dir-action history-action history-action-${node.dir.action}`}
                  >
                    {actionLabels[node.dir.action]}
                  </span>
                )}
              </button>
              {isExpanded && renderFileTree(node.children, revision, depth + 1)}
            </li>
          )
        }

        return (
          <li className="history-file-tree-entry" key={node.path}>
            {node.file &&
              renderFileButton(node.file, revision, node.name, depth)}
          </li>
        )
      })}
    </ul>
  )

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
        setExpandedRevision(revision)
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
      !isDirectory,
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
    isDirectory,
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
      aria-label={`${entrySubject}历史：${entry.name}`}
    >
      <div className="history-layout">
        <aside className="history-panel" aria-label="改动历史">
          <div className="history-panel-head">
            <div>
              <strong>改动历史</strong>
              <span>
                {history ? `${history.entries.length} 个修订版本` : '读取中'}
              </span>
            </div>
            <div
              className="history-file-view-selector"
              role="group"
              aria-label="变更文件展示方式"
            >
              <button
                className={`history-file-view-choice${fileListView === 'tree' ? ' is-selected' : ''}`}
                type="button"
                onClick={() => chooseFileListView('tree')}
                aria-label="树形展示"
                aria-pressed={fileListView === 'tree'}
                title="树形展示"
              >
                <ListTree size={15} aria-hidden="true" />
              </button>
              <button
                className={`history-file-view-choice${fileListView === 'list' ? ' is-selected' : ''}`}
                type="button"
                onClick={() => chooseFileListView('list')}
                aria-label="列表展示"
                aria-pressed={fileListView === 'list'}
                title="列表展示"
              >
                <List size={15} aria-hidden="true" />
              </button>
            </div>
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
                // Folder history also surfaces directory changes (e.g. a tag
                // created by copying a directory), which have no file entry.
                const changedItems = isDirectory ? revision.files : changedFiles
                const isExpanded = expandedRevision === revision.revision

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
                            {isDirectory
                              ? `${changedItems.length} 项变更`
                              : `${changedFiles.length} 个文件`}
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
                        {fileListView === 'tree'
                          ? renderFileTree(
                              buildChangedFileTree(changedItems, location.url),
                              revision.revision,
                            )
                          : changedItems.map((item) =>
                              item.kind === 'directory'
                                ? renderDirectoryItem(item)
                                : renderFileButton(
                                    item,
                                    revision.revision,
                                    formatRevisionPath(item.path, location.url),
                                  ),
                            )}
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
            <div className="history-panel-state">该{entrySubject}没有可显示的历史记录。</div>
          )}
        </aside>

        <section className="history-code-panel" aria-label={isDirectory ? '变更文件' : '文件代码'}>
          <div className="history-code-head">
            {selectedFile ? (
              <>
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
              </>
            ) : (
              <>
                <span className="history-code-icon">
                  {isDirectory ? <Folder size={15} /> : <FileCode2 size={15} />}
                </span>
                <div>
                  <strong>{isDirectory ? '文件夹内容' : '文件代码'}</strong>
                  <span>{entryDisplayPath}</span>
                </div>
              </>
            )}
            <button
              className="comparison-close"
              type="button"
              onClick={onClose}
              aria-label={`关闭${entrySubject}历史`}
              title="关闭"
            >
              <X size={19} />
            </button>
          </div>
          <div className="history-code-body">
            {selectedFile ? (
              isFileLoading ? (
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
              ) : null
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
                <p>
                  展开任意修订版本，然后点击文件查看该版本与上一版本的差异。
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  )
}
