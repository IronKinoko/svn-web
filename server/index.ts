import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  createLocation,
  deleteLocation,
  readLocation,
  readLocations,
  updateLocation,
  type StoredLocation,
} from './location-store.js'
import {
  cacheDirectory,
  cacheExpandedPaths,
  clearTreeCache,
  invalidateTreeCacheSubtree,
  isValidCachePath,
  isValidLocationId,
  readTreeCache,
  type TreeEntry,
} from './tree-cache.js'

const app = Fastify({ logger: true })
const clientDirectory = resolve(process.cwd(), 'dist/client')
const clientIndex = join(clientDirectory, 'index.html')
const allowedProtocols = new Set(['http:', 'https:', 'svn:', 'svn+ssh:'])

function parseRemoteUrl(value: string) {
  if (!value || value.length > 2048) throw new Error('请输入有效的 SVN 地址')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('请输入有效的 SVN 地址')
  }

  if (
    !allowedProtocols.has(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('仅支持不含账号信息的 http、https、svn 或 svn+ssh 地址')
  }

  return url.toString().replace(/\/+$/, '')
}

function parseStoredLocation(body: Partial<StoredLocation>, id?: string) {
  if (
    typeof body.name !== 'string' ||
    !body.name.trim() ||
    body.name.length > 512 ||
    typeof body.url !== 'string' ||
    typeof body.username !== 'string' ||
    body.username.length > 512 ||
    (body.password !== undefined && typeof body.password !== 'string') ||
    (typeof body.password === 'string' && body.password.length > 4096)
  ) {
    throw new Error('地址或登录凭据无效')
  }

  if (id !== undefined && !isValidLocationId(id)) {
    throw new Error('地址标识无效')
  }

  return {
    ...(id ? { id } : {}),
    name: body.name.trim(),
    url: parseRemoteUrl(body.url),
    username: body.username,
    ...(typeof body.password === 'string' ? { password: body.password } : {}),
  }
}

function toPublicLocation(
  { password, ...location }: StoredLocation,
) {
  return { ...location, hasPassword: Boolean(password ?? '') }
}

function decodeXml(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    if (entity[0] !== '#') {
      const namedEntities: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
      }
      return namedEntities[entity.toLowerCase()] ?? match
    }

    const codePoint = entity[1]?.toLowerCase() === 'x'
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10)
    try {
      return String.fromCodePoint(codePoint)
    } catch {
      return match
    }
  })
}

function parseSvnEntries(xml: string, relativePath: string): TreeEntry[] {
  const entries: TreeEntry[] = []
  const entryPattern = /<entry\b([^>]*)>([\s\S]*?)<\/entry>/g

  for (const match of xml.matchAll(entryPattern)) {
    const kind = /\bkind="(dir|file)"/.exec(match[1] ?? '')?.[1]
    const name = decodeXml(/<name>([\s\S]*?)<\/name>/.exec(match[2] ?? '')?.[1] ?? '')
    if (!name || name.includes('/')) continue

    const commitDate = decodeXml(
      /<commit\b[^>]*>[\s\S]*?<date>([\s\S]*?)<\/date>[\s\S]*?<\/commit>/.exec(
        match[2] ?? '',
      )?.[1] ?? '',
    ).trim()
    const author = decodeXml(
      /<commit\b[^>]*>[\s\S]*?<author>([\s\S]*?)<\/author>[\s\S]*?<\/commit>/.exec(
        match[2] ?? '',
      )?.[1] ?? '',
    ).trim()
    const parsedCommitDate = commitDate ? new Date(commitDate) : null

    entries.push({
      name,
      path: relativePath ? `${relativePath}/${name}` : name,
      kind: kind === 'dir' ? 'directory' : 'file',
      ...(author ? { author } : {}),
      ...(parsedCommitDate && !Number.isNaN(parsedCommitDate.getTime())
        ? { modifiedAt: parsedCommitDate.toISOString() }
        : {}),
    })
  }

  return entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}

function runSvnList(targetUrl: string, username?: string, password?: string) {
  return new Promise<string>((resolveOutput, reject) => {
    const args = [
      'list',
      '--xml',
      '--depth',
      'immediates',
      '--non-interactive',
    ]
    if (username) args.push('--username', username)
    if (password) args.push('--password', password, '--no-auth-cache')
    args.push(targetUrl)

    execFile(
      'svn',
      args,
      { encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          let message = stderr.trim() || 'SVN command failed'
          for (const secret of [password, username]) {
            if (secret) message = message.split(secret).join('[隐藏]')
          }
          reject(new Error(message.slice(0, 1200)))
          return
        }
        resolveOutput(stdout)
      },
    )
  })
}

function appendRemotePath(baseUrl: string, relativePath: string) {
  if (
    relativePath.length > 2048 ||
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    relativePath.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('目录路径无效')
  }

  const segments = relativePath.split('/').filter(Boolean)
  if (!segments.length) return baseUrl

  return `${baseUrl}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`
}

app.get('/api/health', async () => ({ status: 'ok' }))

app.get('/api/remote/locations', async (_request, reply) => {
  reply.header('cache-control', 'no-store')
  try {
    return {
      locations: (await readLocations()).map(toPublicLocation),
    }
  } catch (error) {
    app.log.error({ err: error }, 'Unable to read remote location store')
    return reply.code(500).send({ error: '无法读取后端地址记录' })
  }
})

app.post<{ Body: Partial<StoredLocation> }>(
  '/api/remote/locations',
  async (request, reply) => {
    reply.header('cache-control', 'no-store')
    try {
      const input = parseStoredLocation(request.body ?? {})
      return {
        location: toPublicLocation(
          await createLocation({
            ...input,
            password: input.password ?? '',
          }),
        ),
      }
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : '地址记录无效',
      })
    }
  },
)

app.put<{ Params: { locationId: string }; Body: Partial<StoredLocation> }>(
  '/api/remote/locations/:locationId',
  async (request, reply) => {
    reply.header('cache-control', 'no-store')
    try {
      const location = await updateLocation(
        request.params.locationId,
        parseStoredLocation(request.body ?? {}, request.params.locationId),
      )
      if (!location) return reply.code(404).send({ error: '地址记录不存在' })
      return { location: toPublicLocation(location) }
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : '地址记录无效',
      })
    }
  },
)

app.delete<{ Params: { locationId: string } }>(
  '/api/remote/locations/:locationId',
  async (request, reply) => {
    reply.header('cache-control', 'no-store')
    if (!isValidLocationId(request.params.locationId)) {
      return reply.code(400).send({ error: '地址标识无效' })
    }
    try {
      const deleted = await deleteLocation(request.params.locationId)
      if (!deleted) return reply.code(404).send({ error: '地址记录不存在' })
      await clearTreeCache(request.params.locationId)
      return { deleted: true }
    } catch (error) {
      app.log.error({ err: error }, 'Unable to delete remote location')
      return reply.code(500).send({ error: '无法删除后端地址记录' })
    }
  },
)

function parseCacheIdentity(
  body: { locationId?: string; url?: string; username?: string },
) {
  if (
    typeof body.locationId !== 'string' ||
    !isValidLocationId(body.locationId) ||
    typeof body.url !== 'string' ||
    (body.username !== undefined &&
      (typeof body.username !== 'string' || body.username.length > 512))
  ) {
    throw new Error('缓存地址信息无效')
  }

  return {
    locationId: body.locationId,
    url: parseRemoteUrl(body.url),
    username: body.username ?? '',
  }
}

async function passwordForRequest(
  locationId: string,
  url: string,
  username: string,
) {
  const stored = await readLocation(locationId)
  if (!stored || stored.url !== url || stored.username !== username) return ''
  return stored.password ?? ''
}

app.post<{
  Body: { locationId?: string; url?: string; username?: string }
}>('/api/remote/cache/read', async (request, reply) => {
  try {
    const identity = parseCacheIdentity(request.body ?? {})
    return {
      cache: await readTreeCache(
        identity.locationId,
        identity.url,
        identity.username,
      ),
    }
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : '缓存请求无效',
    })
  }
})

app.put<{
  Body: {
    locationId?: string
    url?: string
    username?: string
    expandedPaths?: string[]
  }
}>('/api/remote/cache/expanded', async (request, reply) => {
  try {
    const identity = parseCacheIdentity(request.body ?? {})
    const { expandedPaths } = request.body ?? {}
    if (
      !Array.isArray(expandedPaths) ||
      expandedPaths.length > 10_000 ||
      expandedPaths.some(
        (path) => typeof path !== 'string' || !isValidCachePath(path),
      )
    ) {
      return reply.code(400).send({ error: '展开目录记录无效' })
    }

    await cacheExpandedPaths(
      identity.locationId,
      identity.url,
      identity.username,
      expandedPaths,
    )
    return { saved: true }
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : '缓存请求无效',
    })
  }
})

app.post<{
  Body: {
    locationId?: string
    url?: string
    username?: string
    path?: string
  }
}>('/api/remote/cache/invalidate', async (request, reply) => {
  try {
    const identity = parseCacheIdentity(request.body ?? {})
    const { path } = request.body ?? {}
    if (typeof path !== 'string' || !isValidCachePath(path, true)) {
      return reply.code(400).send({ error: '缓存目录路径无效' })
    }

    const invalidated = await invalidateTreeCacheSubtree(
      identity.locationId,
      identity.url,
      identity.username,
      path,
    )
    return { invalidated }
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : '缓存刷新请求无效',
    })
  }
})

app.delete<{ Params: { locationId: string } }>(
  '/api/remote/cache/:locationId',
  async (request, reply) => {
    if (!isValidLocationId(request.params.locationId)) {
      return reply.code(400).send({ error: '缓存地址信息无效' })
    }
    try {
      await clearTreeCache(request.params.locationId)
      return { cleared: true }
    } catch {
      return reply.code(500).send({ error: '无法清除远程目录缓存' })
    }
  },
)

app.post<{
  Body: {
    locationId?: string
    url?: string
    path?: string
    username?: string
    password?: string
  }
}>('/api/remote/tree', async (request, reply) => {
  let baseUrl: string
  let targetUrl: string
  try {
    if (
      typeof request.body?.locationId !== 'string' ||
      !isValidLocationId(request.body.locationId)
    ) {
      throw new Error('缓存地址信息无效')
    }
    baseUrl = parseRemoteUrl(request.body?.url ?? '')
    targetUrl = appendRemotePath(baseUrl, request.body?.path ?? '')
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : '请求参数无效',
    })
  }

  const { username } = request.body ?? {}

  try {
    const storedLocation = await readLocation(request.body.locationId!)
    if (
      storedLocation &&
      (storedLocation.url !== baseUrl || storedLocation.username !== (username ?? ''))
    ) {
      return reply.code(400).send({ error: '地址或用户名与已保存记录不一致' })
    }
  } catch (error) {
    app.log.error({ err: error }, 'Unable to read stored location for SVN request')
    return reply.code(500).send({ error: '无法读取后端地址记录' })
  }

  if (
    username !== undefined &&
      (typeof username !== 'string' || username.length > 512)
  ) {
    return reply.code(400).send({ error: '用户名长度无效' })
  }

  try {
    const effectivePassword = await passwordForRequest(
      request.body.locationId!,
      baseUrl,
      username ?? '',
    )
    const xml = await runSvnList(targetUrl, username, effectivePassword)
    const entries = parseSvnEntries(xml, request.body?.path ?? '')
    let cachePersisted = true
    try {
      await cacheDirectory(
        request.body.locationId!,
        baseUrl,
        username ?? '',
        request.body.path ?? '',
        entries,
      )
    } catch (error) {
      cachePersisted = false
      app.log.error({ err: error }, 'Unable to persist remote SVN directory cache')
    }
    return { entries, cachePersisted }
  } catch (error) {
    app.log.warn({ err: error }, 'Unable to list remote SVN directory')
    return reply.code(502).send({
      error: error instanceof Error ? error.message : '无法读取远程 SVN 目录',
    })
  }
})

if (existsSync(clientDirectory)) {
  await app.register(fastifyStatic, { root: clientDirectory })
}

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api')) {
    return reply.code(404).send({ error: 'Not found' })
  }
  if (existsSync(clientIndex)) return reply.type('text/html').sendFile('index.html')
  return reply.code(404).send({ error: 'Not found' })
})

try {
  await app.listen({
    host:
      process.env.HOST ??
      (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
    port: Number(process.env.PORT ?? 3000),
  })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
