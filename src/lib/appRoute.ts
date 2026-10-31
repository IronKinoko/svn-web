export type RemoteAppRoute = {
  page: 'remote'
  locationId?: string
  path?: string
  extraSearch?: Array<[string, string]>
}

export type HistoryAppRoute = {
  page: 'history'
  locationId: string
  path: string
  revision?: number
  filePath?: string
  extraSearch?: Array<[string, string]>
}

export type AppRoute = RemoteAppRoute | HistoryAppRoute

function normalizeLocationId(value?: string) {
  const locationId = value?.trim()
  if (!locationId || !/^[A-Za-z0-9]{6}$/.test(locationId)) {
    return undefined
  }
  return locationId
}

function normalizeRepositoryPath(value?: string) {
  if (value === undefined) return undefined

  const path = value.trim().replace(/^\/+|\/+$/g, '')
  if (
    !path ||
    path.length > 2048 ||
    path.includes('\\') ||
    path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return undefined
  }
  return path
}

function normalizeRevision(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return undefined
  const revision = Number(value)
  return Number.isSafeInteger(revision) && revision > 0 ? revision : undefined
}

export function parseAppRoute(
  locationIdValue: string | undefined,
  viewValue: string | undefined,
  pathValue: string | undefined,
  search: string,
): AppRoute {
  const locationId = normalizeLocationId(locationIdValue)
  const params = new URLSearchParams(search)
  const queryView = params.get('view')
  const isLegacyView = queryView === 'history' || queryView === 'remote'
  const hasLegacyQueryPath = isLegacyView && params.has('path')
  const usesQueryPath =
    hasLegacyQueryPath && viewValue !== 'history'
  const rawPath =
    viewValue === 'history'
      ? pathValue
      : usesQueryPath
        ? params.get('path') ?? undefined
        : viewValue === 'remote'
          ? pathValue
          : [viewValue, pathValue].filter(Boolean).join('/')
  const path = normalizeRepositoryPath(rawPath)
  const isHistory = viewValue === 'history' || queryView === 'history'
  const revision = normalizeRevision(params.get('revision'))
  const filePath = normalizeRepositoryPath(params.get('file') ?? undefined)
  const extraSearch = [...params.entries()].filter(
    ([key]) =>
      !['revision', 'file', 'location'].includes(key) &&
      !(key === 'view' && isLegacyView) &&
      !(key === 'path' && hasLegacyQueryPath),
  )

  if (isHistory && locationId && path) {
    return {
      page: 'history',
      locationId,
      path,
      ...(revision ? { revision } : {}),
      ...(filePath ? { filePath } : {}),
      ...(extraSearch.length ? { extraSearch } : {}),
    }
  }

  return {
    page: 'remote',
    ...(locationId ? { locationId } : {}),
    ...(path ? { path } : {}),
    ...(extraSearch.length ? { extraSearch } : {}),
  }
}

function encodeRepositoryPath(path: string) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function appendExtraSearch(params: URLSearchParams, extraSearch?: Array<[string, string]>) {
  for (const [key, value] of extraSearch ?? []) {
    params.append(key, value)
  }
}

export function serializeAppRoute(route: AppRoute) {
  const locationId = normalizeLocationId(route.locationId)
  const path = normalizeRepositoryPath(route.path)
  const pathname = locationId
    ? `/${encodeURIComponent(locationId)}/${route.page}${path ? `/${encodeRepositoryPath(path)}` : ''}`
    : '/'
  const params = new URLSearchParams()

  if (route.page === 'history' && locationId && path) {
    if (route.revision) params.set('revision', String(route.revision))
    if (route.filePath) params.set('file', route.filePath)
  }
  appendExtraSearch(params, route.extraSearch)
  const search = params.toString()

  return search ? `${pathname}?${search}` : pathname
}

export function sameAppRoute(left: AppRoute, right: AppRoute) {
  return serializeAppRoute(left) === serializeAppRoute(right)
}
