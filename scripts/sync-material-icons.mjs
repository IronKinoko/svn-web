import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const packageRoot = dirname(require.resolve('material-icon-theme/package.json'))
const sourceDir = join(packageRoot, 'icons')
const targetDir = join(projectRoot, 'public', 'material-icons')

rmSync(targetDir, { recursive: true, force: true })
mkdirSync(targetDir, { recursive: true })
cpSync(sourceDir, targetDir, { recursive: true })
cpSync(join(packageRoot, 'LICENSE'), join(targetDir, 'LICENSE'))

console.log(`Synced ${readdirSync(sourceDir).length} material icons to ${targetDir}`)
