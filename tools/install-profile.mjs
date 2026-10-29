#!/usr/bin/env node
/**
 * 把本插件挂进一个 DSH profile。
 *
 *   node tools/install-profile.mjs --dry          # 只看会改什么
 *   node tools/install-profile.mjs                # 改 package.json + 跑 pnpm install
 *   node tools/install-profile.mjs --profile-dir C:/Users/me/.dsh/profiles/web
 *
 * 做的事只有两件（和 dsh plugin add 的效果一致）：
 *   1. profile package.json 的 dependencies 里加一条 file: 链接
 *   2. dsh.profile.bundles 末尾加本包名（bundle 层才会套用 cordis.patch.yml）
 * 然后在该目录跑 pnpm install 把链接接上。
 *
 * 幂等：已经装过就什么都不改，只补跑一次 pnpm install。
 */
import { spawnSync } from 'node:child_process'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACKAGE = JSON.parse(await readFile(join(PLUGIN_DIR, 'package.json'), 'utf8'))
const NAME = PACKAGE.name

function argOf(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? fallback : process.argv[index + 1]
}

const DRY = process.argv.includes('--dry')
const FILE_MODE = process.argv.includes('--file')
const PROFILE_DIR = resolve(argOf('--profile-dir', join(homedir(), '.dsh', 'profiles', 'desktop')))
const NODE = argOf('--node', process.execPath)
const PNPM = argOf('--pnpm', join(dirname(NODE), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'))

/**
 * 依赖里写链接用正斜杠，Windows 上 pnpm 也认。
 * 默认 `link:`（真符号链接，改代码刷新页面就生效）；`--file` 用 `file:`（拷一份，适合定稿后分发）。
 */
const SPEC = `${FILE_MODE ? 'file' : 'link'}:${PLUGIN_DIR.split('\\').join('/')}`

const manifestPath = join(PROFILE_DIR, 'package.json')
let manifest
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
} catch (error) {
  console.error(`读不到 profile 的 package.json：${manifestPath}`)
  console.error(String(error?.message ?? error))
  process.exit(1)
}

const before = JSON.stringify(manifest, null, 2)
manifest.dependencies = { ...(manifest.dependencies ?? {}) }
manifest.dependencies[NAME] = SPEC
manifest.dsh = { ...(manifest.dsh ?? {}) }
manifest.dsh.profile = { ...(manifest.dsh.profile ?? {}) }
const bundles = Array.isArray(manifest.dsh.profile.bundles) ? [...manifest.dsh.profile.bundles] : []
if (!bundles.includes(NAME)) bundles.push(NAME)
manifest.dsh.profile.bundles = bundles

// 依赖按名字排序，diff 干净一点；bundles 保持追加顺序（顺序即叠加顺序）。
const sortedDeps = {}
for (const key of Object.keys(manifest.dependencies).sort()) sortedDeps[key] = manifest.dependencies[key]
manifest.dependencies = sortedDeps

const after = JSON.stringify(manifest, null, 2) + '\n'
const changed = JSON.stringify(JSON.parse(before), null, 2) + '\n' !== after

console.log(`profile   ${PROFILE_DIR}`)
console.log(`plugin    ${PLUGIN_DIR}`)
console.log(`依赖声明   ${NAME}: ${SPEC}`)
console.log(`bundle 层  ${bundles.join(' -> ')}`)

if (!changed) {
  console.log('package.json 已经是这个状态，不需要改。')
} else if (DRY) {
  console.log('--dry：会改写 package.json，并跑 pnpm install。')
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${manifestPath}.${stamp}.bak`
  await copyFile(manifestPath, backup)
  await writeFile(manifestPath, after, 'utf8')
  console.log(`已改写 package.json（备份 ${backup}）`)
}

if (DRY && changed) process.exit(0)

const result = spawnSync(NODE, [PNPM, 'install', '--reporter=append-only'], {
  cwd: PROFILE_DIR,
  stdio: 'inherit',
})
if (result.error !== undefined) {
  console.error(`跑不起 pnpm：${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  console.error(`pnpm install 失败（exit ${result.status}）`)
  process.exit(result.status ?? 1)
}
console.log('装好了：刷新页面即可生效（宿主半改动需重启或重载插件行）。')