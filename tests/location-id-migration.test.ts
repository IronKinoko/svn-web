import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('startup migration replaces old IDs and prunes their tree caches', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'svn-web-migration-'))
  const previousDataDirectory = process.env.SVN_DESK_DATA_DIR
  process.env.SVN_DESK_DATA_DIR = dataDirectory
  const oldId = randomUUID()
  const retainedId = 'keep01'

  try {
    await writeFile(
      join(dataDirectory, 'locations.json'),
      JSON.stringify({
        version: 1,
        locations: [
          {
            id: oldId,
            name: 'Legacy',
            url: 'svn://example.test/legacy',
            username: 'user',
            password: 'secret',
            favorites: [{ path: 'trunk/src', name: 'src' }],
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: retainedId,
            name: 'Current',
            url: 'svn://example.test/current',
            username: '',
            password: '',
            favorites: [],
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      }),
    )
    await writeFile(
      join(dataDirectory, 'tree-cache.json'),
      JSON.stringify({
        version: 1,
        locations: {
          [oldId]: {
            url: 'svn://example.test/legacy',
            username: 'user',
            entriesByPath: {},
            expandedPaths: [],
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          [retainedId]: {
            url: 'svn://example.test/current',
            username: '',
            entriesByPath: { '': [] },
            expandedPaths: [],
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        },
      }),
    )

    const [{ createLocation, migrateLocationIds, readLocations }, {
      pruneTreeCache,
      readTreeCache,
    }, { isValidLocationId }] = await Promise.all([
      import('../server/location-store.js'),
      import('../server/tree-cache.js'),
      import('../server/location-id.js'),
    ])

    assert.equal(await migrateLocationIds(), 1)
    const migratedLocations = await readLocations()
    const migratedLocation = migratedLocations.find(
      (location) => location.name === 'Legacy',
    )!
    assert.notEqual(migratedLocation.id, oldId)
    assert.equal(isValidLocationId(migratedLocation.id), true)
    assert.deepEqual(migratedLocation.favorites, [
      { path: 'trunk/src', name: 'src' },
    ])

    const persistedDatabase = JSON.parse(
      await readFile(join(dataDirectory, 'locations.json'), 'utf8'),
    ) as { locations: Array<{ id: string }> }
    assert.equal(persistedDatabase.locations[0]?.id, migratedLocation.id)
    assert.equal(await migrateLocationIds(), 0)

    const createdLocation = await createLocation({
      name: 'New',
      url: 'svn://example.test/new',
      username: '',
      password: '',
    })
    assert.equal(isValidLocationId(createdLocation.id), true)
    assert.equal(
      new Set([...migratedLocations.map(({ id }) => id), createdLocation.id])
        .size,
      migratedLocations.length + 1,
    )

    assert.equal(
      await pruneTreeCache(
        new Set([...migratedLocations.map(({ id }) => id), createdLocation.id]),
      ),
      1,
    )
    assert.ok(
      await readTreeCache(retainedId, 'svn://example.test/current', ''),
    )
    const cacheAfterMigration = JSON.parse(
      await readFile(join(dataDirectory, 'tree-cache.json'), 'utf8'),
    ) as { locations: Record<string, unknown> }
    assert.equal(Object.hasOwn(cacheAfterMigration.locations, oldId), false)
    assert.equal(Object.hasOwn(cacheAfterMigration.locations, retainedId), true)
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.SVN_DESK_DATA_DIR
    } else {
      process.env.SVN_DESK_DATA_DIR = previousDataDirectory
    }
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
