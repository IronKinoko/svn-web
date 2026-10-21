export function isSupportedRemoteUrl(value: string) {
  try {
    const url = new URL(value)
    return (
      ['http:', 'https:', 'svn:', 'svn+ssh:'].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}

export function normalizeRemoteUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

export function inferLocationName(value: string) {
  const parsed = new URL(value)
  return parsed.pathname.split('/').filter(Boolean).at(-1) || parsed.hostname
}

export function buildRemoteEntryUrl(baseUrl: string, path: string) {
  const segments = path.split('/').filter(Boolean)
  if (!segments.length) return normalizeRemoteUrl(baseUrl)
  return `${normalizeRemoteUrl(baseUrl)}/${segments
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}
