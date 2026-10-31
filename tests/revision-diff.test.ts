import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { test } from 'node:test'
import {
  buildAlignedMergeChanges,
  buildRevisionDiff,
  buildRevisionMergeChanges,
} from '../src/lib/revisionDiff'

test('CRLF comparisons keep split and unified change ranges inside CodeMirror documents', () => {
  const unchangedPrefix = `${Array.from(
    { length: 10 },
    (_, index) => `line ${index}`,
  ).join('\r\n')}\r\n`
  const previousContent = `${unchangedPrefix}old value`
  const currentContent = `${unchangedPrefix}new value`

  const revisionDiff = buildRevisionDiff(previousContent, currentContent)
  const alignedPreviousDoc = EditorState.create({
    doc: revisionDiff.alignedPreviousContent,
  }).doc
  const alignedCurrentDoc = EditorState.create({
    doc: revisionDiff.alignedCurrentContent,
  }).doc
  const alignedChanges = buildAlignedMergeChanges(revisionDiff.rows)

  assert.ok(alignedChanges.length > 0)
  for (const change of alignedChanges) {
    assert.ok(change.fromA >= 0)
    assert.ok(change.fromB >= 0)
    assert.ok(change.fromA <= change.toA)
    assert.ok(change.fromB <= change.toB)
    assert.ok(change.toA <= alignedPreviousDoc.length)
    assert.ok(change.toB <= alignedCurrentDoc.length)
  }

  const previousDoc = EditorState.create({ doc: previousContent }).doc
  const currentDoc = EditorState.create({ doc: currentContent }).doc
  const revisionChanges = buildRevisionMergeChanges(
    previousContent,
    currentContent,
  ).changes

  assert.ok(revisionChanges.length > 0)
  for (const change of revisionChanges) {
    assert.ok(change.fromA >= 0)
    assert.ok(change.fromB >= 0)
    assert.ok(change.fromA <= change.toA)
    assert.ok(change.fromB <= change.toB)
    assert.ok(change.toA <= previousDoc.length)
    assert.ok(change.toB <= currentDoc.length)
  }
})
