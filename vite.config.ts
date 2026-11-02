import react from '@vitejs/plugin-react'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const require = createRequire(import.meta.url)
const materialIconPackage = dirname(
  require.resolve('material-icon-theme/package.json'),
)
const materialIconDirectory = join(materialIconPackage, 'icons')
const materialIconRoute = '/material-icons/'

function materialIcons(): Plugin {
  return {
    name: 'svn-material-icons',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(materialIconRoute)) return next()

        let fileName: string
        try {
          const pathname = new URL(request.url, 'http://localhost').pathname
          fileName = decodeURIComponent(pathname.slice(materialIconRoute.length))
        } catch {
          return next()
        }

        if (!fileName || fileName !== basename(fileName)) return next()

        try {
          const source = readFileSync(join(materialIconDirectory, fileName))
          response.statusCode = 200
          response.setHeader('Content-Type', 'image/svg+xml')
          response.setHeader('Cache-Control', 'no-cache')
          response.end(source)
        } catch {
          next()
        }
      })
    },
    generateBundle() {
      for (const fileName of readdirSync(materialIconDirectory)) {
        if (!fileName.endsWith('.svg')) continue
        this.emitFile({
          type: 'asset',
          fileName: `material-icons/${fileName}`,
          source: readFileSync(join(materialIconDirectory, fileName)),
        })
      }
      this.emitFile({
        type: 'asset',
        fileName: 'material-icons/LICENSE',
        source: readFileSync(join(materialIconPackage, 'LICENSE')),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), materialIcons()],
  build: {
    outDir: 'dist/client',
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
