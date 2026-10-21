import type { RemoteLocation } from '../types/remote'

type LegacyRemoteLocation = Partial<RemoteLocation> & {
  rememberPassword?: boolean
}

type LegacyCredential = {
  username?: string
  password?: string
}

const locationsStorageKey = 'svn-desk.remote-locations'
const locationMigrationStorageKey = 'svn-desk.locations-migrated'
const legacySessionCredentialsStorageKey = 'svn-desk.session-credentials'

function readStoredLocations(): RemoteLocation[] {
  try {
    const stored = localStorage.getItem(locationsStorageKey)
    if (!stored) return []
    const parsed = JSON.parse(stored) as Array<LegacyRemoteLocation>
    let legacyCredentials: Record<string, LegacyCredential> = {}
    try {
      const storedCredentials = sessionStorage.getItem(
        legacySessionCredentialsStorageKey,
      )
      if (storedCredentials) {
        const parsedCredentials = JSON.parse(storedCredentials) as Record<
          string,
          LegacyCredential
        >
        if (parsedCredentials && typeof parsedCredentials === 'object') {
          legacyCredentials = parsedCredentials
        }
      }
    } catch {
      // Legacy credentials are optional and can be ignored if malformed.
    }

    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item) =>
              typeof item.id === 'string' &&
              typeof item.name === 'string' &&
              typeof item.url === 'string',
          )
          .map((item) => {
            const legacy = legacyCredentials[item.id!]
            const username =
              typeof item.username === 'string'
                ? item.username
                : typeof legacy?.username === 'string'
                  ? legacy.username
                  : ''
            const password =
              typeof item.password === 'string'
                ? item.password
                : typeof legacy?.password === 'string'
                  ? legacy.password
                  : ''

            return {
              id: item.id!,
              name: item.name!,
              url: item.url!,
              username,
              ...(password ? { password } : {}),
            }
          })
      : []
  } catch {
    return []
  }
}

export function readLegacyLocations() {
  let stored: RemoteLocation[] = []
  try {
    stored = readStoredLocations()
  } catch {
    return { stored, migrated: false }
  }

  const hasMigrationMarker = localStorage.getItem(locationMigrationStorageKey) === '1'
  const storedRaw = localStorage.getItem(locationsStorageKey)
  return {
    stored,
    migrated: hasMigrationMarker || !storedRaw || stored.length === 0,
  }
}

export function clearLegacyLocationStorage() {
  localStorage.setItem(locationMigrationStorageKey, '1')
  localStorage.removeItem(locationsStorageKey)
  localStorage.removeItem(legacySessionCredentialsStorageKey)
  sessionStorage.removeItem(legacySessionCredentialsStorageKey)
}
