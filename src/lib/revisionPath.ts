function pathSegments(path: string) {
  return path.split('/').filter(Boolean)
}

function basePathSegments(baseUrl: string) {
  try {
    return pathSegments(new URL(baseUrl).pathname)
  } catch {
    return []
  }
}

export function repositoryRelativePath(path: string, baseUrl: string) {
  const segments = pathSegments(path)
  const baseSegments = basePathSegments(baseUrl)

  if (
    baseSegments.length &&
    baseSegments.every((segment, index) => segments[index] === segment)
  ) {
    return segments.slice(baseSegments.length).join('/')
  }

  return segments.join('/')
}

export function formatRevisionPath(path: string, baseUrl: string) {
  const repositoryPath = repositoryRelativePath(path, baseUrl)
  const segments = pathSegments(repositoryPath)
  const layoutIndex = segments.findIndex(
    (segment) => segment === 'trunk' || segment === 'branches',
  )

  if (layoutIndex >= 0) {
    const relativeStart =
      segments[layoutIndex] === 'branches' ? layoutIndex + 2 : layoutIndex + 1
    const relativePath = segments.slice(relativeStart).join('/')
    if (relativePath) return relativePath
  }

  return repositoryPath
}

export function isSameRevisionPath(
  revisionPath: string,
  currentPath: string,
  baseUrl: string,
) {
  const revisionRelativePath = repositoryRelativePath(revisionPath, baseUrl)
  const currentRelativePath = repositoryRelativePath(currentPath, baseUrl)

  return (
    revisionRelativePath === currentRelativePath ||
    revisionRelativePath.endsWith(`/${currentRelativePath}`) ||
    currentRelativePath.endsWith(`/${revisionRelativePath}`)
  )
}
