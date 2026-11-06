import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  createLocation,
  deleteLocation,
  migrateLocationIds,
  readLocation,
  readLocations,
  updateLocation,
  updateLocationFavorites,
  type StoredLocation,
} from './location-store.js'
import {
  cacheDirectory,
  cacheExpandedPaths,
  clearTreeCache,
  invalidateTreeCacheSubtree,
  isValidCachePath,
  pruneTreeCache,
  readTreeCache,
  type TreeEntry,
} from './tree-cache.js'
import { isValidLocationId } from './location-id.js'

const app = Fastify({ logger: true })
const clientDirectory = resolve(process.env.SVN_DESK_CLIENT_DIR ?? 'dist/client')
const clientIndex = join(clientDirectory, 'index.html')
const allowedProtocols = new Set(['http:', 'https:', 'svn:', 'svn+ssh:'])
const maxComparisonFileBytes = 2 * 1024 * 1024
const historyPageSize = 50

type SvnLogEntry = {
  revision: number
  author?: string
  modifiedAt?: string
}

type SvnChangedPath = {
  path: string
  action: 'A' | 'M' | 'D' | 'R'
  kind: 'file' | 'directory'
}

type SvnHistoryEntry = SvnLogEntry & {
  message: string
  files: SvnChangedPath[]
}

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

function parseFavoriteFolders(value: unknown) {
  if (!Array.isArray(value) || value.length > 200) {
    throw new Error('收藏目录数据无效')
  }

  const favorites = value.map((favorite) => {
    if (
      !favorite ||
      typeof favorite !== 'object' ||
      typeof favorite.path !== 'string' ||
      !isValidCachePath(favorite.path) ||
      typeof favorite.name !== 'string' ||
      !favorite.name.trim() ||
      favorite.name.length > 512 ||
      (favorite.author !== undefined &&
        (typeof favorite.author !== 'string' || favorite.author.length > 512)) ||
      (favorite.modifiedAt !== undefined &&
        (typeof favorite.modifiedAt !== 'string' ||
          favorite.modifiedAt.length > 128))
    ) {
      throw new Error('收藏目录数据无效')
    }

    return {
      path: favorite.path,
      name: favorite.name.trim(),
      ...(favorite.author ? { author: favorite.author } : {}),
      ...(favorite.modifiedAt ? { modifiedAt: favorite.modifiedAt } : {}),
    }
  })

  if (new Set(favorites.map((favorite) => favorite.path)).size !== favorites.length) {
    throw new Error('收藏目录不能重复')
  }
  return favorites
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

function sanitizeSvnError(
  error: Error,
  stderr: string,
  username?: string,
  password?: string,
) {
  const errorCode = (error as NodeJS.ErrnoException).code
  let message =
    errorCode === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      ? `文件过大，在线对比上限为 ${maxComparisonFileBytes / 1024 / 1024} MB`
      : stderr.trim() || 'SVN command failed'

  for (const secret of [password, username]) {
    if (secret) message = message.split(secret).join('[隐藏]')
  }
  return message.slice(0, 1200)
}

function runSvnLog(
  targetUrl: string,
  username?: string,
  password?: string,
  revision?: number,
) {
  return new Promise<string>((resolveOutput, reject) => {
    const args = [
      'log',
      '--xml',
      '--limit',
      '2',
      '--non-interactive',
    ]
    if (revision) args.push('-r', `${revision}:1`)
    if (username) args.push('--username', username)
    if (password) args.push('--password', password, '--no-auth-cache')
    args.push(`${targetUrl}@${revision ?? 'HEAD'}`)

    execFile(
      'svn',
      args,
      { encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              sanitizeSvnError(error, String(stderr ?? ''), username, password),
            ),
          )
          return
        }
        resolveOutput(stdout)
      },
    )
  })
}

function runSvnCat(
  targetUrl: string,
  revision: number,
  username?: string,
  password?: string,
  pegRevision = 'HEAD',
) {
  return new Promise<Buffer>((resolveOutput, reject) => {
    const args = [
      'cat',
      '--non-interactive',
      '-r',
      String(revision),
    ]
    if (username) args.push('--username', username)
    if (password) args.push('--password', password, '--no-auth-cache')
    args.push(`${targetUrl}@${pegRevision}`)

    execFile(
      'svn',
      args,
      {
        encoding: 'buffer',
        timeout: 20_000,
        maxBuffer: maxComparisonFileBytes + 64 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const errorOutput = Buffer.isBuffer(stderr)
            ? stderr.toString('utf8')
            : String(stderr ?? '')
          reject(
            new Error(
              sanitizeSvnError(error, errorOutput, username, password),
            ),
          )
          return
        }

        const output = Buffer.isBuffer(stdout)
          ? stdout
          : Buffer.from(String(stdout ?? ''))
        if (output.length > maxComparisonFileBytes) {
          reject(
            new Error(
              `文件过大，在线对比上限为 ${maxComparisonFileBytes / 1024 / 1024} MB`,
            ),
          )
          return
        }
        resolveOutput(output)
      },
    )
  })
}

function runSvnHistory(
  targetUrl: string,
  beforeRevision?: number,
  username?: string,
  password?: string,
) {
  return new Promise<string>((resolveOutput, reject) => {
    const args = [
      'log',
      '--xml',
      '--verbose',
      '--limit',
      String(historyPageSize + 1),
      '--non-interactive',
    ]
    if (beforeRevision) {
      args.push('-r', `${beforeRevision - 1}:1`)
    }
    if (username) args.push('--username', username)
    if (password) args.push('--password', password, '--no-auth-cache')
    args.push(`${targetUrl}@HEAD`)

    execFile(
      'svn',
      args,
      { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              sanitizeSvnError(error, String(stderr ?? ''), username, password),
            ),
          )
          return
        }
        resolveOutput(stdout)
      },
    )
  })
}

function parseSvnLogEntries(xml: string): SvnLogEntry[] {
  const entries: SvnLogEntry[] = []
  const entryPattern = /<logentry\b([^>]*)>([\s\S]*?)<\/logentry>/g

  for (const match of xml.matchAll(entryPattern)) {
    const revision = Number(
      /\brevision="(\d+)"/.exec(match[1] ?? '')?.[1] ?? '',
    )
    if (!Number.isSafeInteger(revision) || revision <= 0) continue

    const body = match[2] ?? ''
    const author = decodeXml(
      /<author>([\s\S]*?)<\/author>/.exec(body)?.[1] ?? '',
    ).trim()
    const date = decodeXml(
      /<date>([\s\S]*?)<\/date>/.exec(body)?.[1] ?? '',
    ).trim()
    const parsedDate = date ? new Date(date) : null

    entries.push({
      revision,
      ...(author ? { author } : {}),
      ...(parsedDate && !Number.isNaN(parsedDate.getTime())
        ? { modifiedAt: parsedDate.toISOString() }
        : {}),
    })
  }

  return entries.sort((left, right) => right.revision - left.revision)
}

function parseSvnHistoryEntries(xml: string): SvnHistoryEntry[] {
  const entries: SvnHistoryEntry[] = []
  const entryPattern = /<logentry\b([^>]*)>([\s\S]*?)<\/logentry>/g

  for (const match of xml.matchAll(entryPattern)) {
    const revision = Number(
      /\brevision="(\d+)"/.exec(match[1] ?? '')?.[1] ?? '',
    )
    if (!Number.isSafeInteger(revision) || revision <= 0) continue

    const body = match[2] ?? ''
    const author = decodeXml(
      /<author>([\s\S]*?)<\/author>/.exec(body)?.[1] ?? '',
    ).trim()
    const date = decodeXml(
      /<date>([\s\S]*?)<\/date>/.exec(body)?.[1] ?? '',
    ).trim()
    const message = decodeXml(
      /<msg>([\s\S]*?)<\/msg>/.exec(body)?.[1] ?? '',
    ).trim()
    const parsedDate = date ? new Date(date) : null
    const files: SvnChangedPath[] = []

    for (const pathMatch of body.matchAll(
      /<path\b([^>]*)>([\s\S]*?)<\/path>/g,
    )) {
      const attributes = pathMatch[1] ?? ''
      const path = decodeXml(pathMatch[2] ?? '').trim()
      const kind =
        /\bkind="(file|dir)"/.exec(attributes)?.[1] === 'dir'
          ? 'directory'
          : 'file'
      const action = /\baction="([AMDR])"/.exec(attributes)?.[1]

      if (!path.startsWith('/') || path.includes('\\')) continue
      files.push({
        path,
        kind,
        action: (action as SvnChangedPath['action'] | undefined) ?? 'M',
      })
    }

    entries.push({
      revision,
      ...(author ? { author } : {}),
      ...(parsedDate && !Number.isNaN(parsedDate.getTime())
        ? { modifiedAt: parsedDate.toISOString() }
        : {}),
      message: message.slice(0, 4000),
      files,
    })
  }

  return entries.sort((left, right) => right.revision - left.revision)
}

function decodeSvnFileContent(buffer: Buffer) {
  if (buffer.includes(0)) {
    throw new Error('该文件是二进制文件，暂不支持在线代码对比')
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error('该文件不是 UTF-8 文本，暂不支持在线代码对比')
  }
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

app.get('/api/locations', async (_request, reply) => {
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

app.get<{ Params: { locationId: string } }>(
  '/api/locations/:locationId',
  async (request, reply) => {
    reply.header('cache-control', 'no-store')
    if (!isValidLocationId(request.params.locationId)) {
      return reply.code(400).send({ error: '地址标识无效' })
    }
    try {
      const location = await readLocation(request.params.locationId)
      if (!location) return reply.code(404).send({ error: '地址记录不存在' })
      return { location: toPublicLocation(location) }
    } catch (error) {
      app.log.error({ err: error }, 'Unable to read remote location')
      return reply.code(500).send({ error: '无法读取后端地址记录' })
    }
  },
)

app.post<{ Body: Partial<StoredLocation> }>(
  '/api/locations',
  async (request, reply) => {
    reply.header('cache-control', 'no-store')
    try {
      const input = parseStoredLocation(request.body ?? {})
      return reply.code(201).send({
        location: toPublicLocation(
          await createLocation({
            ...input,
            password: input.password ?? '',
          }),
        ),
      })
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : '地址记录无效',
      })
    }
  },
)

app.put<{ Params: { locationId: string }; Body: Partial<StoredLocation> }>(
  '/api/locations/:locationId',
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

app.put<{
  Params: { locationId: string }
  Body: { favorites?: unknown }
}>(
  '/api/locations/:locationId/favorites',
  async (request, reply) => {
    reply.header('cache-control', 'no-store')
    if (!isValidLocationId(request.params.locationId)) {
      return reply.code(400).send({ error: '地址标识无效' })
    }

    try {
      const favorites = parseFavoriteFolders(request.body?.favorites)
      const location = await updateLocationFavorites(
        request.params.locationId,
        favorites,
      )
      if (!location) return reply.code(404).send({ error: '地址记录不存在' })
      return { location: toPublicLocation(location) }
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : '无法保存收藏目录',
      })
    }
  },
)

app.delete<{ Params: { locationId: string } }>(
  '/api/locations/:locationId',
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

function parseLocationIdParam(value: string | undefined, message: string) {
  if (typeof value !== 'string' || !isValidLocationId(value)) {
    throw new Error(message)
  }
  return value
}

function parseOptionalInteger(value: unknown, message: string) {
  if (value === undefined) return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(message)
  return parsed
}

app.get<{
  Params: { locationId: string }
}>('/api/locations/:locationId/cache', async (request, reply) => {
  reply.header('cache-control', 'no-store')
  let locationId: string
  try {
    locationId = parseLocationIdParam(request.params.locationId, '地址标识无效')
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : '缓存请求无效',
    })
  }

  try {
    const stored = await readLocation(locationId)
    if (!stored) return reply.code(404).send({ error: '地址记录不存在' })
    return {
      cache: await readTreeCache(locationId, stored.url, stored.username),
    }
  } catch (error) {
    app.log.error({ err: error }, 'Unable to read remote tree cache')
    return reply.code(500).send({ error: '无法读取后端目录缓存' })
  }
})

app.put<{
  Params: { locationId: string }
  Body: {
    expandedPaths?: string[]
  }
}>('/api/locations/:locationId/cache/expanded', async (request, reply) => {
  reply.header('cache-control', 'no-store')
  let locationId: string
  try {
    locationId = parseLocationIdParam(request.params.locationId, '地址标识无效')
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : '缓存请求无效',
    })
  }

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

  try {
    const stored = await readLocation(locationId)
    if (!stored) return reply.code(404).send({ error: '地址记录不存在' })
    await cacheExpandedPaths(
      locationId,
      stored.url,
      stored.username,
      expandedPaths,
    )
    return { saved: true }
  } catch (error) {
    app.log.error({ err: error }, 'Unable to persist expanded tree paths')
    return reply.code(500).send({ error: '无法保存已展开目录' })
  }
})

app.delete<{
  Params: { locationId: string }
  Querystring: { path?: string }
}>('/api/locations/:locationId/cache/entries', async (request, reply) => {
  reply.header('cache-control', 'no-store')
  let locationId: string
  try {
    locationId = parseLocationIdParam(request.params.locationId, '地址标识无效')
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : '缓存刷新请求无效',
    })
  }

  const { path } = request.query
  if (typeof path !== 'string' || !isValidCachePath(path, true)) {
    return reply.code(400).send({ error: '缓存目录路径无效' })
  }

  try {
    const stored = await readLocation(locationId)
    if (!stored) return reply.code(404).send({ error: '地址记录不存在' })
    const invalidated = await invalidateTreeCacheSubtree(
      locationId,
      stored.url,
      stored.username,
      path,
    )
    return { invalidated }
  } catch (error) {
    app.log.error({ err: error }, 'Unable to invalidate tree cache subtree')
    return reply.code(500).send({ error: '无法刷新目录缓存' })
  }
})

app.delete<{ Params: { locationId: string } }>(
  '/api/locations/:locationId/cache',
  async (request, reply) => {
    reply.header('cache-control', 'no-store')
    if (!isValidLocationId(request.params.locationId)) {
      return reply.code(400).send({ error: '地址标识无效' })
    }
    try {
      await clearTreeCache(request.params.locationId)
      return { cleared: true }
    } catch {
      return reply.code(500).send({ error: '无法清除远程目录缓存' })
    }
  },
)

app.get<{
  Params: { locationId: string }
  Querystring: { path?: string }
}>('/api/locations/:locationId/tree', async (request, reply) => {
  reply.header('cache-control', 'no-store')
  let locationId: string
  try {
    locationId = parseLocationIdParam(request.params.locationId, '地址标识无效')
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : '请求参数无效',
    })
  }

  const path = request.query.path ?? ''

  let stored: StoredLocation | null = null
  try {
    stored = await readLocation(locationId)
  } catch (error) {
    app.log.error({ err: error }, 'Unable to read stored location for SVN request')
    return reply.code(500).send({ error: '无法读取后端地址记录' })
  }
  if (!stored) return reply.code(404).send({ error: '地址记录不存在' })

  let targetUrl: string
  try {
    targetUrl = appendRemotePath(stored.url, path)
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : '请求参数无效',
    })
  }

  try {
    const xml = await runSvnList(targetUrl, stored.username, stored.password)
    const entries = parseSvnEntries(xml, path)
    let cachePersisted = true
    try {
      await cacheDirectory(
        locationId,
        stored.url,
        stored.username,
        path,
        entries,
      )
    } catch (error) {
      cachePersisted = false
      app.log.error({ err: error }, 'Unable to persist remote SVN directory cache')
    }
    return { entries, cachePersisted }
  } catch (error) {
    app.log.warn({ err: error }, 'Unable to list remote SVN directory')
    const message =
      error instanceof Error ? error.message : '无法读取远程 SVN 目录'
    const pathMissing =
      /\bW160013\b|\bE200009\b|non-existent in revision/i.test(message)
    return reply.code(502).send({
      error: message,
      ...(pathMissing ? { code: 'SVN_PATH_NOT_FOUND' } : {}),
    })
  }
})

app.get<{
  Params: { locationId: string }
  Querystring: { path?: string; revision?: string }
}>('/api/locations/:locationId/file', async (request, reply) => {
  reply.header('cache-control', 'no-store')
  let locationId: string
  let stored: StoredLocation | null = null
  let targetUrl: string
  let filePath: string
  let revision: number | undefined

  try {
    locationId = parseLocationIdParam(request.params.locationId, '地址标识无效')
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : '文件对比请求无效',
    })
  }

  try {
    stored = await readLocation(locationId)
  } catch (error) {
    app.log.error({ err: error }, 'Unable to read stored location for file comparison')
    return reply.code(500).send({ error: '无法读取后端地址记录' })
  }
  if (!stored) return reply.code(404).send({ error: '地址记录不存在' })

  try {
    filePath = request.query.path as string
    if (typeof filePath !== 'string' || !isValidCachePath(filePath)) {
      throw new Error('文件路径无效')
    }
    revision = parseOptionalInteger(request.query.revision, '文件修订版本无效')
    if (revision !== undefined && revision <= 0) {
      throw new Error('文件修订版本无效')
    }
    targetUrl = appendRemotePath(stored.url, filePath)
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : '文件对比请求无效',
    })
  }

  try {
    const logEntries = parseSvnLogEntries(
      await runSvnLog(targetUrl, stored.username, stored.password, revision),
    )
    if (!logEntries.length) {
      return reply.code(404).send({ error: '该文件没有可用的 SVN 修订记录' })
    }

    const currentIndex = Math.max(
      0,
      logEntries.findIndex((entry) => entry.revision === revision),
    )
    const currentLog = logEntries[currentIndex]!
    const previousLog = logEntries[currentIndex + 1]
    const [currentBytes, previousBytes] = await Promise.all([
      runSvnCat(
        targetUrl,
        currentLog.revision,
        stored.username,
        stored.password,
        String(currentLog.revision),
      ),
      previousLog
        ? runSvnCat(
            targetUrl,
            previousLog.revision,
            stored.username,
            stored.password,
            String(currentLog.revision),
          )
        : Promise.resolve(null),
    ])

    return {
      comparison: {
        path: filePath,
        current: {
          ...currentLog,
          content: decodeSvnFileContent(currentBytes),
        },
        previous:
          previousLog && previousBytes
            ? {
                ...previousLog,
                content: decodeSvnFileContent(previousBytes),
              }
            : null,
      },
    }
  } catch (error) {
    app.log.warn({ err: error }, 'Unable to load remote SVN file comparison')
    return reply.code(502).send({
      error:
        error instanceof Error ? error.message : '无法读取远程 SVN 文件内容',
    })
  }
})

app.get<{
  Params: { locationId: string }
  Querystring: { path?: string; beforeRevision?: string }
}>('/api/locations/:locationId/file/history', async (request, reply) => {
  reply.header('cache-control', 'no-store')
  let locationId: string
  let stored: StoredLocation | null = null
  let targetUrl: string
  let filePath: string
  let beforeRevision: number | undefined

  try {
    locationId = parseLocationIdParam(request.params.locationId, '地址标识无效')
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : '文件历史请求无效',
    })
  }

  try {
    stored = await readLocation(locationId)
  } catch (error) {
    app.log.error({ err: error }, 'Unable to read stored location for file history')
    return reply.code(500).send({ error: '无法读取后端地址记录' })
  }
  if (!stored) return reply.code(404).send({ error: '地址记录不存在' })

  try {
    filePath = request.query.path as string
    if (typeof filePath !== 'string' || !isValidCachePath(filePath)) {
      throw new Error('文件路径无效')
    }
    beforeRevision = parseOptionalInteger(
      request.query.beforeRevision,
      '历史版本游标无效',
    )
    if (beforeRevision !== undefined && beforeRevision <= 1) {
      throw new Error('历史版本游标无效')
    }
    targetUrl = appendRemotePath(stored.url, filePath)
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : '文件历史请求无效',
    })
  }

  try {
    const entries = parseSvnHistoryEntries(
      await runSvnHistory(
        targetUrl,
        beforeRevision,
        stored.username,
        stored.password,
      ),
    )
    return {
      history: {
        path: filePath,
        entries: entries.slice(0, historyPageSize),
        hasMore: entries.length > historyPageSize,
      },
    }
  } catch (error) {
    app.log.warn({ err: error }, 'Unable to load remote SVN file history')
    return reply.code(502).send({
      error: error instanceof Error ? error.message : '无法读取远程 SVN 文件历史',
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
  const migratedLocationCount = await migrateLocationIds()
  const locations = await readLocations()
  let removedCacheCount = 0
  try {
    removedCacheCount = await pruneTreeCache(
      new Set(locations.map((location) => location.id)),
    )
  } catch (error) {
    app.log.warn({ err: error }, 'Unable to prune obsolete tree caches')
  }
  if (migratedLocationCount || removedCacheCount) {
    app.log.info(
      { migratedLocationCount, removedCacheCount },
      'Migrated remote location IDs to two-character IDs',
    )
  }

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
