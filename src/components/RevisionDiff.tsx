import {
  defaultHighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
  type LanguageSupport,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import {
  MergeView,
  unifiedMergeView,
} from '@codemirror/merge'
import {
  EditorState,
  RangeSet,
  type Extension,
  type Range,
  type Text,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  gutterWidgetClass,
  lineNumberMarkers,
  lineNumberWidgetMarker,
  lineNumbers,
} from '@codemirror/view'
import {
  Columns2,
  Minus,
  MonitorSmartphone,
  Plus,
  Rows3,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatModifiedAt } from '../lib/format'
import {
  buildAlignedMergeChanges,
  buildRevisionDiff,
  buildRevisionMergeChanges,
  resolveRevisionDiffLayout,
  type DiffLayout,
  type DiffLayoutMode,
  type DiffLine,
} from '../lib/revisionDiff'
import type { FileComparison, FileRevision } from '../types/remote'

type RevisionDiffProps = {
  comparison: FileComparison
  path: string
}

type DiffStats = {
  added: number
  removed: number
}

const DIFF_LAYOUT_STORAGE_KEY = 'diff-view'
const AUTO_SPLIT_QUERY = '(min-width: 1200px)'
const unchangedCollapseConfig = { margin: 5, minSize: 5 }

class DiffLineNumberMarker extends GutterMarker {
  elementClass: string

  constructor(elementClass: string) {
    super()
    this.elementClass = elementClass
  }
}

const deletedLineNumberMarker = new DiffLineNumberMarker(
  'cm-deletedLineNumber',
)
const changedLineNumberMarker = new DiffLineNumberMarker(
  'cm-changedLineNumber',
)
const removedChangeMarker = new DiffLineNumberMarker(
  'svn-diff-change-removed',
)
const addedChangeMarker = new DiffLineNumberMarker(
  'svn-diff-change-added',
)
const collapsedLineWidgetMarker = new DiffLineNumberMarker(
  'cm-collapsedLineNumber',
)
const collapsedLineWidgetClasses = gutterWidgetClass.of((view, widget) => {
  const node = widget.toDOM(view)
  return node instanceof HTMLElement &&
    node.classList.contains('cm-collapsedLines')
    ? collapsedLineWidgetMarker
    : null
})
const deletedLineNumberWidgetMarker = lineNumberWidgetMarker.of(
  (view, widget) => {
    const node = widget.toDOM(view)
    return node instanceof HTMLElement &&
      node.classList.contains('cm-deletedChunk')
      ? deletedLineNumberMarker
      : null
  },
)

function readStoredDiffLayout(): DiffLayoutMode {
  try {
    const storedLayout = window.localStorage.getItem(DIFF_LAYOUT_STORAGE_KEY)
    if (
      storedLayout === 'split' ||
      storedLayout === 'unified' ||
      storedLayout === 'auto'
    ) {
      return storedLayout
    }
    return 'auto'
  } catch {
    return 'auto'
  }
}

function synchronizeHorizontalScroll(mergeView: MergeView) {
  const leftScroller = mergeView.a.scrollDOM
  const rightScroller = mergeView.b.scrollDOM
  const expectedScrollPositions = new WeakMap<HTMLElement, number>()

  const syncScroll = (source: HTMLElement, target: HTMLElement) => {
    const expectedScrollLeft = expectedScrollPositions.get(source)
    if (expectedScrollLeft !== undefined) {
      expectedScrollPositions.delete(source)
      if (Math.abs(source.scrollLeft - expectedScrollLeft) < 1) return
    }

    if (target.scrollLeft === source.scrollLeft) return
    target.scrollLeft = source.scrollLeft
    expectedScrollPositions.set(target, target.scrollLeft)
  }
  const syncLeftToRight = () => syncScroll(leftScroller, rightScroller)
  const syncRightToLeft = () => syncScroll(rightScroller, leftScroller)

  leftScroller.addEventListener('scroll', syncLeftToRight, { passive: true })
  rightScroller.addEventListener('scroll', syncRightToLeft, { passive: true })

  return () => {
    leftScroller.removeEventListener('scroll', syncLeftToRight)
    rightScroller.removeEventListener('scroll', syncRightToLeft)
  }
}

const editorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: '#ffffff',
      color: '#27332b',
      fontSize: '12px',
    },
    '.cm-scroller': {
      fontFamily: 'var(--mono)',
      lineHeight: '1.65',
    },
    '.cm-content': {
      padding: '0 0 18px',
    },
    '.cm-gutters': {
      border: '0',
      backgroundColor: '#f8faf7',
      color: '#9aa59b',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '45px',
      padding: '0 10px 0 6px',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
    },
  },
  { dark: false },
)

const baseExtensions: Extension = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  collapsedLineWidgetClasses,
  EditorState.phrases.of({
    '$ unchanged lines': '$ 行未修改，点击展开',
  }),
  editorTheme,
]

function fileName(path: string) {
  return path.split('/').pop() || path
}

function buildLineNumberMarkers(
  doc: Text,
  lines: readonly (DiffLine | null)[],
  side: 'a' | 'b',
): Extension {
  const marker = side === 'a' ? deletedLineNumberMarker : changedLineNumberMarker
  const ranges: ReturnType<GutterMarker['range']>[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line || line.kind === 'equal' || index >= doc.lines) continue
    ranges.push(marker.range(doc.line(index + 1).from))
  }

  return lineNumberMarkers.of(RangeSet.of(ranges, true))
}

function buildLineHighlights(
  doc: Text,
  lines: readonly (DiffLine | null)[],
  side: 'a' | 'b',
): Extension {
  const decorations: Range<Decoration>[] = []
  const lineClass =
    side === 'a' ? 'svn-diff-line-removed' : 'svn-diff-line-added'
  const textClass =
    side === 'a' ? 'svn-diff-text-removed' : 'svn-diff-text-added'

  for (let index = 0; index < lines.length && index < doc.lines; index += 1) {
    const modelLine = lines[index]
    const editorLine = doc.line(index + 1)
    if (!modelLine) {
      decorations.push(
        Decoration.line({ class: 'svn-diff-line-placeholder' }).range(
          editorLine.from,
        ),
      )
      continue
    }
    if (modelLine.kind === 'equal') continue

    decorations.push(Decoration.line({ class: lineClass }).range(editorLine.from))

    if (modelLine.kind !== 'changed') continue
    for (const segment of modelLine.segments) {
      const from = editorLine.from + Math.min(segment.from, editorLine.length)
      const to = editorLine.from + Math.min(segment.to, editorLine.length)
      if (to > from) {
        decorations.push(Decoration.mark({ class: textClass }).range(from, to))
      }
    }
  }

  return EditorView.decorations.of(Decoration.set(decorations, true))
}

function buildAlignedLineNumbers(
  sourceLineNumbers: readonly (number | null)[],
): Extension {
  return lineNumbers({
    formatNumber: (lineNumber) => {
      const sourceLineNumber = sourceLineNumbers[lineNumber - 1]
      return sourceLineNumber == null ? '' : String(sourceLineNumber)
    },
  })
}

function buildChangeGutter(
  doc: Text,
  lines: readonly (DiffLine | null)[],
  side: 'a' | 'b',
): Extension {
  const marker = side === 'a' ? removedChangeMarker : addedChangeMarker
  const ranges: ReturnType<GutterMarker['range']>[] = []

  for (let index = 0; index < lines.length && index < doc.lines; index += 1) {
    const line = lines[index]
    if (!line || line.kind === 'equal') continue
    ranges.push(marker.range(doc.line(index + 1).from))
  }

  return gutter({
    class: 'svn-diff-change-gutter',
    markers: () => RangeSet.of(ranges, true),
  })
}

function RevisionLabel({
  label,
  revision,
}: {
  label: string
  revision: FileRevision | null
}) {
  return (
    <div className="history-diff-revision">
      <span className="history-diff-revision-name">{label}</span>
      {revision ? (
        <>
          <code>r{revision.revision}</code>
          <span className="history-diff-revision-meta">
            {revision.author || '未知作者'} · {formatModifiedAt(revision.modifiedAt)}
          </span>
        </>
      ) : (
        <span className="history-diff-revision-meta">文件初始版本</span>
      )}
    </div>
  )
}

export function RevisionDiff({ comparison, path }: RevisionDiffProps) {
  const host = useRef<HTMLDivElement>(null)
  const [stats, setStats] = useState<DiffStats>({ added: 0, removed: 0 })
  const [layoutMode, setLayoutMode] =
    useState<DiffLayoutMode>(readStoredDiffLayout)
  const [isWideViewport, setIsWideViewport] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia(AUTO_SPLIT_QUERY).matches,
  )
  const hasPreviousVersion = comparison.previous !== null
  const selectedLayoutMode: DiffLayoutMode = hasPreviousVersion
    ? layoutMode
    : 'unified'
  const layout: DiffLayout = resolveRevisionDiffLayout(
    layoutMode,
    isWideViewport,
    hasPreviousVersion,
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia(AUTO_SPLIT_QUERY)
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsWideViewport(event.matches)
    }

    mediaQuery.addEventListener('change', handleViewportChange)
    return () =>
      mediaQuery.removeEventListener('change', handleViewportChange)
  }, [])

  useEffect(() => {
    const element = host.current
    if (!element) return

    let cancelled = false
    let mergeView: MergeView | null = null
    let editorView: EditorView | null = null
    let removeHorizontalScrollSync: (() => void) | null = null

    const mountEditor = async () => {
      const description = LanguageDescription.matchFilename(
        languages,
        fileName(path),
      )
      let languageSupport: LanguageSupport | null = null

      if (description) {
        try {
          languageSupport = await description.load()
        } catch {
          // CodeMirror still renders the file as plain text when highlighting fails.
        }
      }

      if (cancelled) return

      const previousContent = comparison.previous?.content ?? ''
      const currentContent = comparison.current.content
      const originalCurrentDoc = EditorState.create({
        doc: currentContent,
      }).doc
      const diffModel = buildRevisionDiff(previousContent, currentContent)
      const alignedPreviousDoc = EditorState.create({
        doc: diffModel.alignedPreviousContent,
      }).doc
      const alignedCurrentDoc = EditorState.create({
        doc: diffModel.alignedCurrentContent,
      }).doc
      const alignedPreviousLines = diffModel.rows.map((row) => row.previous)
      const alignedCurrentLines = diffModel.rows.map((row) => row.current)
      const alignedPreviousLineNumbers = diffModel.rows.map(
        (row) => row.previousLineNumber,
      )
      const alignedCurrentLineNumbers = diffModel.rows.map(
        (row) => row.currentLineNumber,
      )
      const mergeLayout = buildRevisionMergeChanges(
        previousContent,
        currentContent,
      )
      const diffConfig = {
        override: () => mergeLayout.changes,
      }
      const alignedMergeChanges = buildAlignedMergeChanges(diffModel.rows)
      const alignedDiffConfig = {
        override: () => alignedMergeChanges,
      }
      const alignedPreviousLineNumberMarkers = buildLineNumberMarkers(
        alignedPreviousDoc,
        alignedPreviousLines,
        'a',
      )
      const alignedCurrentLineNumberMarkers = buildLineNumberMarkers(
        alignedCurrentDoc,
        alignedCurrentLines,
        'b',
      )
      const alignedPreviousLineHighlights = buildLineHighlights(
        alignedPreviousDoc,
        alignedPreviousLines,
        'a',
      )
      const alignedCurrentLineHighlights = buildLineHighlights(
        alignedCurrentDoc,
        alignedCurrentLines,
        'b',
      )
      const currentLineNumberMarkers = buildLineNumberMarkers(
        originalCurrentDoc,
        diffModel.currentLines,
        'b',
      )
      const currentLineHighlights = buildLineHighlights(
        originalCurrentDoc,
        diffModel.currentLines,
        'b',
      )
      setStats({ added: diffModel.added, removed: diffModel.removed })

      const languageExtensions = languageSupport
        ? [languageSupport.extension]
        : []

      if (layout === 'unified') {
        editorView = new EditorView({
          state: EditorState.create({
            doc: comparison.current.content,
            extensions: [
              baseExtensions,
              ...languageExtensions,
              lineNumbers(),
              currentLineNumberMarkers,
              currentLineHighlights,
              deletedLineNumberWidgetMarker,
              unifiedMergeView({
                original: previousContent,
                highlightChanges: true,
                gutter: true,
                mergeControls: false,
                allowInlineDiffs: false,
                collapseUnchanged: unchangedCollapseConfig,
                diffConfig,
              }),
            ],
          }),
          parent: element,
        })
        return
      }

      mergeView = new MergeView({
        a: {
          doc: diffModel.alignedPreviousContent,
          extensions: [
            baseExtensions,
            ...languageExtensions,
            buildChangeGutter(
              alignedPreviousDoc,
              alignedPreviousLines,
              'a',
            ),
            buildAlignedLineNumbers(alignedPreviousLineNumbers),
            alignedPreviousLineNumberMarkers,
            alignedPreviousLineHighlights,
          ],
        },
        b: {
          doc: diffModel.alignedCurrentContent,
          extensions: [
            baseExtensions,
            ...languageExtensions,
            buildChangeGutter(
              alignedCurrentDoc,
              alignedCurrentLines,
              'b',
            ),
            buildAlignedLineNumbers(alignedCurrentLineNumbers),
            alignedCurrentLineNumberMarkers,
            alignedCurrentLineHighlights,
          ],
        },
        parent: element,
        highlightChanges: false,
        gutter: false,
        collapseUnchanged: unchangedCollapseConfig,
        diffConfig: alignedDiffConfig,
      })
      removeHorizontalScrollSync = synchronizeHorizontalScroll(mergeView)
    }

    void mountEditor()

    return () => {
      cancelled = true
      removeHorizontalScrollSync?.()
      mergeView?.destroy()
      editorView?.destroy()
      element.replaceChildren()
    }
  }, [comparison, layout, path])

  const chooseLayout = (nextLayout: DiffLayoutMode) => {
    if (!hasPreviousVersion && nextLayout !== 'unified') return
    setLayoutMode(nextLayout)
    try {
      window.localStorage.setItem(DIFF_LAYOUT_STORAGE_KEY, nextLayout)
    } catch {
      // The selected layout still applies when local storage is unavailable.
    }
  }

  return (
    <div className="history-diff">
      <div className="history-diff-summary">
        <div className="comparison-diff-stats" aria-label="代码变更统计">
          <span className="diff-added">
            <Plus size={12} /> {stats.added}
          </span>
          <span className="diff-removed">
            <Minus size={12} /> {stats.removed}
          </span>
        </div>
        <span className="history-diff-description">
          {layout === 'split' ? '左右分栏' : '单窗口'}逐行对比 · 完整文件内容
        </span>
        <div
          className="history-diff-layout-selector"
          role="group"
          aria-label="对比布局"
        >
          <button
            className={`history-diff-layout-choice${selectedLayoutMode === 'split' ? ' is-selected' : ''}`}
            type="button"
            aria-pressed={selectedLayoutMode === 'split'}
            aria-label="左右对比"
            title={
              hasPreviousVersion
                ? '固定使用左右对比'
                : '没有上一版本，无法左右对比'
            }
            disabled={!hasPreviousVersion}
            onClick={() => chooseLayout('split')}
          >
            <Columns2 size={15} aria-hidden="true" />
          </button>
          <button
            className={`history-diff-layout-choice${selectedLayoutMode === 'unified' ? ' is-selected' : ''}`}
            type="button"
            aria-pressed={selectedLayoutMode === 'unified'}
            aria-label="单窗口"
            title="固定使用单窗口对比"
            onClick={() => chooseLayout('unified')}
          >
            <Rows3 size={15} aria-hidden="true" />
          </button>
          <button
            className={`history-diff-layout-choice${selectedLayoutMode === 'auto' ? ' is-selected' : ''}`}
            type="button"
            aria-pressed={selectedLayoutMode === 'auto'}
            aria-label="自动布局"
            title={
              hasPreviousVersion
                ? '自动：窗口较宽时左右对比，较窄时单窗口'
                : '没有上一版本，无法自动对比'
            }
            disabled={!hasPreviousVersion}
            onClick={() => chooseLayout('auto')}
          >
            <MonitorSmartphone size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        className={`history-diff-column-heads${layout === 'unified' ? ' is-unified' : ''}`}
      >
        {layout === 'split' ? (
          <>
            <RevisionLabel label="上一版本" revision={comparison.previous} />
            <RevisionLabel label="选中版本" revision={comparison.current} />
          </>
        ) : (
          <>
            <RevisionLabel label="统一对比" revision={comparison.current} />
            <span className="history-diff-unified-baseline">
              基线{' '}
              {comparison.previous
                ? `r${comparison.previous.revision} · ${comparison.previous.author || '未知作者'}`
                : '文件初始版本'}
            </span>
          </>
        )}
      </div>
      <div className="history-diff-editor-frame">
        <div
          ref={host}
          className={`history-diff-editor${layout === 'unified' ? ' is-unified' : ''}`}
        />
      </div>
    </div>
  )
}
