import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { generateLocationId, isValidLocationId } from './location-id.js'

export type StoredLocation = {
  id: string
  name: string
  url: string
  username: string
  password: string
  favorites: StoredFavoriteFolder[]
  updatedAt: string
}

export type StoredFavoriteFolder = {
  path: string
  name: string
  author?: string
  modifiedAt?: string
}

type LocationDatabase = {
  version: 1
  locations: StoredLocation[]
}

const locationFile = resolve(
  process.env.SVN_DESK_DATA_DIR ?? resolve(process.cwd(), 'data'),
  'locations.json',
)

let mutationQueue: Promise<void> = Promise.resolve()

function emptyDatabase(): LocationDatabase {
  return { version: 1, locations: [] }
}

async function readDatabase(): Promise<LocationDatabase> {
  try {
    const contents = await readFile(locationFile, 'utf8')
    const parsed = JSON.parse(contents) as Partial<LocationDatabase>
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.locations) ||
      parsed.locations.some(
        (location) =>
          !location ||
          typeof location.id !== 'string' ||
          typeof location.name !== 'string' ||
          typeof location.url !== 'string' ||
          typeof location.username !== 'string' ||
          (location.password !== undefined &&
            typeof location.password !== 'string'),
      )
    ) {
      throw new Error('SVN location store has an unsupported format')
    }
    return {
      version: 1,
      locations: parsed.locations.map((location) => ({
        ...location,
        favorites: Array.isArray(location.favorites)
          ? location.favorites.filter(
              (favorite): favorite is StoredFavoriteFolder =>
                Boolean(
                  favorite &&
                    typeof favorite.path === 'string' &&
                    favorite.path &&
                    typeof favorite.name === 'string' &&
                    favorite.name &&
                    (favorite.author === undefined ||
                      typeof favorite.author === 'string') &&
                    (favorite.modifiedAt === undefined ||
                      typeof favorite.modifiedAt === 'string'),
                ),
            )
          : [],
      })),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDatabase()
    throw error
  }
}

async function writeDatabase(database: LocationDatabase) {
  await mkdir(dirname(locationFile), { recursive: true, mode: 0o700 })
  const temporaryFile = `${locationFile}.${randomBytes(16).toString('hex')}.tmp`
  await writeFile(temporaryFile, JSON.stringify(database), {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporaryFile, locationFile)
}

function mutateDatabase<T>(mutate: (database: LocationDatabase) => T) {
  const operation = mutationQueue.then(async () => {
    const database = await readDatabase()
    const result = mutate(database)
    await writeDatabase(database)
    return result
  })
  mutationQueue = operation.then(() => undefined, () => undefined)
  return operation
}

export function migrateLocationIds() {
  const operation = mutationQueue.then(async () => {
    const database = await readDatabase()
    const usedIds = new Set<string>()

    for (const location of database.locations) {
      if (!isValidLocationId(location.id)) continue
      if (usedIds.has(location.id)) {
        throw new Error(`重复的远程地址标识: ${location.id}`)
      }
      usedIds.add(location.id)
    }

    let migratedCount = 0
    for (const location of database.locations) {
      if (isValidLocationId(location.id)) continue
      location.id = generateLocationId(usedIds)
      usedIds.add(location.id)
      migratedCount += 1
    }

    if (migratedCount > 0) await writeDatabase(database)
    return migratedCount
  })
  mutationQueue = operation.then(() => undefined, () => undefined)
  return operation
}

export async function readLocations() {
  await mutationQueue
  const database = await readDatabase()
  return database.locations
}

export async function readLocation(id: string) {
  await mutationQueue
  const database = await readDatabase()
  return database.locations.find((location) => location.id === id) ?? null
}

export function upsertLocation(
  input: Pick<StoredLocation, 'id' | 'name' | 'url' | 'username' | 'password'>,
) {
  return mutateDatabase((database) => {
    const existingIndex = database.locations.findIndex(
      (location) => location.id === input.id,
    )
    const location: StoredLocation = {
      ...input,
      favorites:
        existingIndex === -1
          ? []
          : database.locations[existingIndex].favorites,
      updatedAt: new Date().toISOString(),
    }

    if (existingIndex === -1) database.locations.push(location)
    else database.locations[existingIndex] = location

    return location
  })
}

export function createLocation(
  input: Omit<StoredLocation, 'id' | 'updatedAt' | 'favorites'>,
) {
  return mutateDatabase((database) => {
    const id = generateLocationId(
      new Set(database.locations.map((location) => location.id)),
    )

    const location: StoredLocation = {
      id,
      name: input.name,
      url: input.url,
      username: input.username,
      password: input.password,
      favorites: [],
      updatedAt: new Date().toISOString(),
    }
    database.locations.push(location)
    return location
  })
}

export function updateLocation(
  id: string,
  input: Pick<StoredLocation, 'name' | 'url' | 'username'> & {
    password?: string
  },
) {
  return mutateDatabase((database) => {
    const index = database.locations.findIndex((location) => location.id === id)
    if (index === -1) return null

    const location: StoredLocation = {
      id,
      name: input.name,
      url: input.url,
      username: input.username,
      password: input.password ?? database.locations[index].password ?? '',
      favorites: database.locations[index].favorites,
      updatedAt: new Date().toISOString(),
    }
    database.locations[index] = location
    return location
  })
}

export function updateLocationFavorites(
  id: string,
  favorites: StoredFavoriteFolder[],
) {
  return mutateDatabase((database) => {
    const index = database.locations.findIndex((location) => location.id === id)
    if (index === -1) return null

    database.locations[index] = {
      ...database.locations[index],
      favorites,
      updatedAt: new Date().toISOString(),
    }
    return database.locations[index]
  })
}

export function deleteLocation(id: string) {
  return mutateDatabase((database) => {
    const index = database.locations.findIndex((location) => location.id === id)
    if (index === -1) return false
    database.locations.splice(index, 1)
    return true
  })
}
