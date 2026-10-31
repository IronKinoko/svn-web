import { diffArrays, diffWordsWithSpace } from 'diff'
import { Change } from '@codemirror/merge'
import type {
  FileComparison,
  RevisionFileChange,
} from '../types/remote'

export type DiffLineKind = 'equal' | 'added' | 'removed' | 'changed'

export type DiffTextSegment = {
  from: number
  to: number
}

export type DiffLine = {
  kind: DiffLineKind
  text: string
  segments: DiffTextSegment[]
}

export type DiffRow = {
  previous: DiffLine | null
  current: DiffLine | null
  previousLineNumber: number | null
  currentLineNumber: number | null
}

export type RevisionDiffModel = {
  previousLines: DiffLine[]
  currentLines: DiffLine[]
  rows: DiffRow[]
  alignedPreviousContent: string
  alignedCurrentContent: string
  added: number
  removed: number
}

export type RevisionMergeLayout = {
  changes: Change[]
}

export type DiffLayout = 'split' | 'unified'
export type DiffLayoutMode = DiffLayout | 'auto'

export function prepareRevisionDiffComparison(
  comparison: FileComparison,
  action: RevisionFileChange['action'],
): FileComparison {
  if (action !== 'A' || comparison.previous === null) return comparison
  // An add action starts a new path version, even if SVN returns older ancestry.
  return { ...comparison, previous: null }
}

export function resolveRevisionDiffLayout(
  layoutMode: DiffLayoutMode,
  isWideViewport: boolean,
  hasPreviousVersion: boolean,
): DiffLayout {
  if (!hasPreviousVersion) return 'unified'
  if (layoutMode === 'auto') return isWideViewport ? 'split' : 'unified'
  return layoutMode
}

type OffsetLine = {
  text: string
  from: number
  to: number
  end: number
}

type AlignedLine = {
  previousIndex: number | null
  currentIndex: number | null
}

const MIN_PAIR_SIMILARITY = 0.5
const MAX_ALIGNMENT_CELLS = 250_000

function normalizeLineEndings(content: string) {
  return content.replace(/\r\n?/g, '\n')
}

function splitDiffLines(value: string) {
  if (!value) return []

  const lines = value.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function splitDocumentLines(value: string) {
  return value.split('\n')
}

function buildOffsetLines(content: string): OffsetLine[] {
  const lines: OffsetLine[] = []
  let cursor = 0
  const parts = content.split('\n')

  for (let index = 0; index < parts.length; index += 1) {
    const text = parts[index]
    const hasNewline = index < parts.length - 1
    if (!text && !hasNewline && index === parts.length - 1) break

    lines.push({
      text,
      from: cursor,
      to: cursor + text.length,
      end: cursor + text.length + (hasNewline ? 1 : 0),
    })
    cursor += text.length + (hasNewline ? 1 : 0)
  }

  return lines
}

function appendSegment(
  segments: DiffTextSegment[],
  from: number,
  to: number,
) {
  if (to <= from) return

  const previous = segments.at(-1)
  if (previous?.to === from) {
    previous.to = to
    return
  }
  segments.push({ from, to })
}

function inlineSegments(previous: string, current: string) {
  if (previous.length + current.length > 8000) {
    return {
      previous: previous ? [{ from: 0, to: previous.length }] : [],
      current: current ? [{ from: 0, to: current.length }] : [],
    }
  }

  const previousSegments: DiffTextSegment[] = []
  const currentSegments: DiffTextSegment[] = []
  let previousOffset = 0
  let currentOffset = 0

  for (const change of diffWordsWithSpace(previous, current)) {
    if (change.removed) {
      appendSegment(
        previousSegments,
        previousOffset,
        previousOffset + change.value.length,
      )
      previousOffset += change.value.length
      continue
    }
    if (change.added) {
      appendSegment(
        currentSegments,
        currentOffset,
        currentOffset + change.value.length,
      )
      currentOffset += change.value.length
      continue
    }

    previousOffset += change.value.length
    currentOffset += change.value.length
  }

  if (!previousSegments.length && !currentSegments.length) {
    appendSegment(previousSegments, 0, previous.length)
    appendSegment(currentSegments, 0, current.length)
  }

  return {
    previous: previousSegments,
    current: currentSegments,
  }
}

function lineSimilarity(previous: string, current: string) {
  if (previous === current) return 1

  const totalLength = previous.length + current.length
  if (!totalLength) return 1

  let commonLength = 0
  for (const change of diffWordsWithSpace(previous, current)) {
    if (!change.added && !change.removed) {
      commonLength += change.value.length
    }
  }
  return (2 * commonLength) / totalLength
}

function alignChangedLines(
  previousLines: readonly string[],
  currentLines: readonly string[],
): AlignedLine[] {
  const previousCount = previousLines.length
  const currentCount = currentLines.length
  if (!previousCount) {
    return currentLines.map((_, currentIndex) => ({
      previousIndex: null,
      currentIndex,
    }))
  }
  if (!currentCount) {
    return previousLines.map((_, previousIndex) => ({
      previousIndex,
      currentIndex: null,
    }))
  }

  if (previousCount * currentCount > MAX_ALIGNMENT_CELLS) {
    const pairedCount = Math.min(previousCount, currentCount)
    const previousStart = previousCount - pairedCount
    const currentStart = currentCount - pairedCount
    const aligned: AlignedLine[] = []

    for (let index = 0; index < previousStart; index += 1) {
      aligned.push({ previousIndex: index, currentIndex: null })
    }
    for (let index = 0; index < pairedCount; index += 1) {
      aligned.push({
        previousIndex: previousStart + index,
        currentIndex: currentStart + index,
      })
    }
    for (let index = currentStart; index < currentCount; index += 1) {
      aligned.push({ previousIndex: null, currentIndex: index })
    }
    return aligned
  }

  const scores = Array.from(
    { length: previousCount + 1 },
    () => new Float64Array(currentCount + 1),
  )
  const moves = Array.from(
    { length: previousCount + 1 },
    () => new Uint8Array(currentCount + 1),
  )

  for (let previousIndex = 1; previousIndex <= previousCount; previousIndex += 1) {
    for (let currentIndex = 1; currentIndex <= currentCount; currentIndex += 1) {
      let bestScore = scores[previousIndex - 1][currentIndex]
      let bestMove = 2

      const addScore = scores[previousIndex][currentIndex - 1]
      if (addScore > bestScore) {
        bestScore = addScore
        bestMove = 3
      }

      const similarity = lineSimilarity(
        previousLines[previousIndex - 1],
        currentLines[currentIndex - 1],
      )
      if (similarity >= MIN_PAIR_SIMILARITY) {
        const pairScore =
          scores[previousIndex - 1][currentIndex - 1] + similarity
        if (pairScore >= bestScore) {
          bestScore = pairScore
          bestMove = 1
        }
      }

      scores[previousIndex][currentIndex] = bestScore
      moves[previousIndex][currentIndex] = bestMove
    }
  }

  const aligned: AlignedLine[] = []
  let previousIndex = previousCount
  let currentIndex = currentCount
  while (previousIndex > 0 || currentIndex > 0) {
    if (!previousIndex) {
      aligned.push({ previousIndex: null, currentIndex: currentIndex - 1 })
      currentIndex -= 1
      continue
    }
    if (!currentIndex) {
      aligned.push({ previousIndex: previousIndex - 1, currentIndex: null })
      previousIndex -= 1
      continue
    }

    const move = moves[previousIndex][currentIndex]
    if (move === 1) {
      aligned.push({
        previousIndex: previousIndex - 1,
        currentIndex: currentIndex - 1,
      })
      previousIndex -= 1
      currentIndex -= 1
    } else if (move === 2) {
      aligned.push({ previousIndex: previousIndex - 1, currentIndex: null })
      previousIndex -= 1
    } else {
      aligned.push({ previousIndex: null, currentIndex: currentIndex - 1 })
      currentIndex -= 1
    }
  }

  return aligned.reverse()
}

function inlineChanges(
  previous: OffsetLine,
  current: OffsetLine,
): Change[] {
  if (previous.text.length + current.text.length > 8000) {
    return [
      new Change(previous.from, previous.to, current.from, current.to),
    ]
  }

  const changes: Change[] = []
  let previousOffset = 0
  let currentOffset = 0
  let activeChange:
    | {
        fromA: number
        fromB: number
      }
    | undefined

  const flushChange = () => {
    if (!activeChange) return

    const toA = previous.from + previousOffset
    const toB = current.from + currentOffset
    if (toA > activeChange.fromA || toB > activeChange.fromB) {
      changes.push(
        new Change(activeChange.fromA, toA, activeChange.fromB, toB),
      )
    }
    activeChange = undefined
  }

  for (const part of diffWordsWithSpace(previous.text, current.text)) {
    if (!part.added && !part.removed) {
      flushChange()
      previousOffset += part.value.length
      currentOffset += part.value.length
      continue
    }

    activeChange ??= {
      fromA: previous.from + previousOffset,
      fromB: current.from + currentOffset,
    }
    if (part.removed) previousOffset += part.value.length
    if (part.added) currentOffset += part.value.length
  }
  flushChange()

  if (
    !changes.length &&
    (previous.text.length || current.text.length)
  ) {
    changes.push(
      new Change(previous.from, previous.to, current.from, current.to),
    )
  }

  return changes
}

function equalLine(text: string): DiffLine {
  return { kind: 'equal', text, segments: [] }
}

function addedLine(text: string): DiffLine {
  return { kind: 'added', text, segments: [] }
}

function removedLine(text: string): DiffLine {
  return { kind: 'removed', text, segments: [] }
}

export function buildRevisionMergeChanges(
  previousContent: string,
  currentContent: string,
): RevisionMergeLayout {
  const previous = normalizeLineEndings(previousContent)
  const current = normalizeLineEndings(currentContent)
  const changes: Change[] = []
  const previousSourceLines = splitDiffLines(previous)
  const currentSourceLines = splitDiffLines(current)
  const previousOffsetLines = buildOffsetLines(previous)
  const currentOffsetLines = buildOffsetLines(current)
  let previousIndex = 0
  let currentIndex = 0
  let pendingPrevious: OffsetLine[] = []
  let pendingCurrent: OffsetLine[] = []
  let blockPreviousStart = 0
  let blockCurrentStart = 0

  const offsetAt = (
    lines: OffsetLine[],
    index: number,
    contentLength: number,
  ) => (index < lines.length ? lines[index].from : contentLength)

  const flushChangedBlock = () => {
    const aligned = alignChangedLines(
      pendingPrevious.map((line) => line.text),
      pendingCurrent.map((line) => line.text),
    )
    let previousIndex = 0
    let currentIndex = 0

    for (const line of aligned) {
      if (line.previousIndex !== null && line.currentIndex !== null) {
        const previous = pendingPrevious[line.previousIndex]
        const current = pendingCurrent[line.currentIndex]
        if (previous.text !== current.text) {
          changes.push(...inlineChanges(previous, current))
        }
        previousIndex = line.previousIndex + 1
        currentIndex = line.currentIndex + 1
        continue
      }

      if (line.previousIndex !== null) {
        const previous = pendingPrevious[line.previousIndex]
        const position =
          pendingCurrent[currentIndex]?.from ??
          pendingCurrent.at(-1)?.end ??
          blockCurrentStart
        changes.push(
          new Change(previous.from, previous.end, position, position),
        )
        previousIndex = line.previousIndex + 1
        continue
      }

      const current = pendingCurrent[line.currentIndex!]
      const position =
        pendingPrevious[previousIndex]?.from ??
        pendingPrevious.at(-1)?.end ??
        blockPreviousStart
      changes.push(
        new Change(position, position, current.from, current.end),
      )
      currentIndex = line.currentIndex! + 1
    }

    pendingPrevious = []
    pendingCurrent = []
  }

  for (const change of diffArrays(
    previousSourceLines,
    currentSourceLines,
  )) {
    if (change.removed) {
      if (!pendingPrevious.length && !pendingCurrent.length) {
        blockPreviousStart = offsetAt(
          previousOffsetLines,
          previousIndex,
          previous.length,
        )
        blockCurrentStart = offsetAt(
          currentOffsetLines,
          currentIndex,
          current.length,
        )
      }
      pendingPrevious.push(
        ...previousOffsetLines.slice(
          previousIndex,
          previousIndex + change.value.length,
        ),
      )
      previousIndex += change.value.length
      continue
    }

    if (change.added) {
      if (!pendingPrevious.length && !pendingCurrent.length) {
        blockPreviousStart = offsetAt(
          previousOffsetLines,
          previousIndex,
          previous.length,
        )
        blockCurrentStart = offsetAt(
          currentOffsetLines,
          currentIndex,
          current.length,
        )
      }
      pendingCurrent.push(
        ...currentOffsetLines.slice(
          currentIndex,
          currentIndex + change.value.length,
        ),
      )
      currentIndex += change.value.length
      continue
    }

    flushChangedBlock()
    previousIndex += change.value.length
    currentIndex += change.value.length
  }
  flushChangedBlock()

  return {
    changes,
  }
}

export function buildAlignedMergeChanges(
  rows: readonly DiffRow[],
): Change[] {
  const previousLines = rows.map((row) => row.previous?.text ?? '')
  const currentLines = rows.map((row) => row.current?.text ?? '')
  const previousOffsets: OffsetLine[] = []
  const currentOffsets: OffsetLine[] = []
  let previousCursor = 0
  let currentCursor = 0

  for (let index = 0; index < rows.length; index += 1) {
    const previousText = previousLines[index]
    const currentText = currentLines[index]
    const previousEnd =
      previousCursor +
      previousText.length +
      (index < rows.length - 1 ? 1 : 0)
    const currentEnd =
      currentCursor +
      currentText.length +
      (index < rows.length - 1 ? 1 : 0)

    previousOffsets.push({
      text: previousText,
      from: previousCursor,
      to: previousCursor + previousText.length,
      end: previousEnd,
    })
    currentOffsets.push({
      text: currentText,
      from: currentCursor,
      to: currentCursor + currentText.length,
      end: currentEnd,
    })
    previousCursor = previousEnd
    currentCursor = currentEnd
  }

  const changes: Change[] = []
  let index = 0
  while (index < rows.length) {
    const row = rows[index]
    const isChanged =
      !row.previous ||
      !row.current ||
      row.previous.text !== row.current.text

    if (!isChanged) {
      index += 1
      continue
    }

    let blockEnd = index
    while (blockEnd + 1 < rows.length) {
      const next = rows[blockEnd + 1]
      if (
        next.previous &&
        next.current &&
        next.previous.text === next.current.text
      ) {
        break
      }
      blockEnd += 1
    }

    const previousStart = previousOffsets[index].from
    const currentStart = currentOffsets[index].from
    const previousEnd = previousOffsets[blockEnd].end
    const currentEnd = currentOffsets[blockEnd].end

    // Blank placeholders only take part in a chunk when the same block
    // contains a real text change. A standalone blank line has no
    // character-level difference to report to CodeMirror.
    if (
      previousLines.slice(index, blockEnd + 1).join('\n') !==
      currentLines.slice(index, blockEnd + 1).join('\n')
    ) {
      changes.push(
        new Change(
          previousStart,
          previousEnd,
          currentStart,
          currentEnd,
        ),
      )
    }

    index = blockEnd + 1
  }

  return changes
}

export function buildRevisionDiff(
  previousContent: string,
  currentContent: string,
): RevisionDiffModel {
  const previous = normalizeLineEndings(previousContent)
  const current = normalizeLineEndings(currentContent)
  const previousLines: DiffLine[] = []
  const currentLines: DiffLine[] = []
  const rows: DiffRow[] = []
  let added = 0
  let removed = 0
  let previousLineNumber = 0
  let currentLineNumber = 0
  let pendingPrevious: Array<{ text: string; lineNumber: number }> = []
  let pendingCurrent: Array<{ text: string; lineNumber: number }> = []

  const appendRow = (
    previous: DiffLine | null,
    current: DiffLine | null,
    previousNumber: number | null,
    currentNumber: number | null,
  ) => {
    rows.push({
      previous,
      current,
      previousLineNumber: previousNumber,
      currentLineNumber: currentNumber,
    })
  }

  const flushChangedBlock = () => {
    for (const line of alignChangedLines(
      pendingPrevious.map((item) => item.text),
      pendingCurrent.map((item) => item.text),
    )) {
      if (line.previousIndex !== null && line.currentIndex !== null) {
        const previous = pendingPrevious[line.previousIndex]
        const current = pendingCurrent[line.currentIndex]

        if (previous.text === current.text) {
          const previousLine = equalLine(previous.text)
          const currentLine = equalLine(current.text)
          previousLines.push(previousLine)
          currentLines.push(currentLine)
          appendRow(
            previousLine,
            currentLine,
            previous.lineNumber,
            current.lineNumber,
          )
          continue
        }

        const segments = inlineSegments(previous.text, current.text)
        const previousLine: DiffLine = {
          kind: 'changed',
          text: previous.text,
          segments: segments.previous,
        }
        const currentLine: DiffLine = {
          kind: 'changed',
          text: current.text,
          segments: segments.current,
        }
        previousLines.push(previousLine)
        currentLines.push(currentLine)
        appendRow(
          previousLine,
          currentLine,
          previous.lineNumber,
          current.lineNumber,
        )
        added += 1
        removed += 1
        continue
      }

      if (line.previousIndex !== null) {
        const pending = pendingPrevious[line.previousIndex]
        const previousLine = removedLine(pending.text)
        previousLines.push(previousLine)
        appendRow(previousLine, null, pending.lineNumber, null)
        removed += 1
        continue
      }

      const pending = pendingCurrent[line.currentIndex!]
      const currentLine = addedLine(pending.text)
      currentLines.push(currentLine)
      appendRow(null, currentLine, null, pending.lineNumber)
      added += 1
    }

    pendingPrevious = []
    pendingCurrent = []
  }

  const previousSourceLines = splitDocumentLines(previous)
  const currentSourceLines = splitDocumentLines(current)

  for (const change of diffArrays(
    previousSourceLines,
    currentSourceLines,
  )) {
    if (change.removed) {
      for (const text of change.value) {
        previousLineNumber += 1
        pendingPrevious.push({ text, lineNumber: previousLineNumber })
      }
      continue
    }
    if (change.added) {
      for (const text of change.value) {
        currentLineNumber += 1
        pendingCurrent.push({ text, lineNumber: currentLineNumber })
      }
      continue
    }

    flushChangedBlock()
    for (const line of change.value) {
      previousLineNumber += 1
      currentLineNumber += 1
      const previousLine = equalLine(line)
      const currentLine = equalLine(line)
      previousLines.push(previousLine)
      currentLines.push(currentLine)
      appendRow(
        previousLine,
        currentLine,
        previousLineNumber,
        currentLineNumber,
      )
    }
  }
  flushChangedBlock()

  const alignedPreviousContent = rows
    .map((row) => row.previous?.text ?? '')
    .join('\n')
  const alignedCurrentContent = rows
    .map((row) => row.current?.text ?? '')
    .join('\n')

  return {
    previousLines,
    currentLines,
    rows,
    alignedPreviousContent,
    alignedCurrentContent,
    added,
    removed,
  }
}
