/**
 * install.mjs —— 安装 dsh-glass-v2 插件 + 打窗口材质补丁，全程自动。
 *
 * 步骤：
 *   1. 把 plugin/ 复制到 <profile>/node_modules/dsh-glass-v2；
 *   2. 在 <profile>/package.json 的 dsh.profile.bundles 与 dependencies 里登记；
 *   3. 在 <profile>/cordis.patch.yml 末尾插入插件行（幂等）；
 *   4. 调 patch-asar.mjs 给 app.asar 打材质补丁。
 *
 * 第 4 步需要 app.asar 不被占用（DSH 必须已退出）。若被占用，
 * 脚本会以退出码 3 结束，由 apply-while-closed.ps1 负责等 DSH 退出后重试。
 *
 * 用法：
 *   node install.mjs [--profile <dir>] [--asar <app.asar>] [--material acrylic]
 *                    [--skip-asar] [--dry-run]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = 'dsh-acrylic'

/** 常见安装位置，用于自动探测 app.asar。 */
function detectAsar() {
  if (process.env.DSH_APP_ASAR) return process.env.DSH_APP_ASAR
  const roots = [
    'C:\\Program Files\\DeepSeek Harness\\resources',
    'C:\\Program Files (x86)\\DeepSeek Harness\\resources',
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'deepseek-harness', 'resources'),
    join(process.env.LOCALAPPDATA ?? '', 'DeepSeek Harness', 'resources'),
    'E:\\gongju\\deepseek\\resources',
  ]
  for (const root of roots) {
    const candidate = join(root, 'app.asar')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function parseArgs(argv) {
  const out = {
    profile: process.env.DSH_HOME ? join(process.env.DSH_HOME, 'profiles', 'desktop') : join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop'),
    asar: detectAsar(),
    material: 'acrylic',
    skipAsar: false,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--profile') out.profile = argv[++i]
    else if (token === '--asar') out.asar = argv[++i]
    else if (token === '--material') out.material = argv[++i]
    else if (token === '--skip-asar') out.skipAsar = true
    else if (token === '--dry-run') out.dryRun = true
    else throw new Error(`未知参数: ${token}`)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const profileDir = resolve(args.profile)
const sourceDir = join(HERE, 'plugin')
const targetDir = join(profileDir, 'node_modules', PLUGIN)
const manifestPath = join(profileDir, 'package.json')
const patchPath = join(profileDir, 'cordis.patch.yml')

if (!existsSync(join(sourceDir, 'package.json'))) {
  console.error(`找不到插件源 ${sourceDir}`)
  process.exit(2)
}
if (!existsSync(manifestPath)) {
  console.error(`找不到 profile ${manifestPath}`)
  process.exit(2)
}

// ---------- 1. 复制插件 ----------
if (!args.dryRun) {
  rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(targetDir, { recursive: true })
  for (const file of ['package.json', 'index.js', 'client.js', 'cordis.patch.yml']) {
    copyFileSync(join(sourceDir, file), join(targetDir, file))
  }
}
console.log(`[1/4] 插件已就位：${targetDir}`)

// ---------- 2. package.json ----------
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= []
manifest.dependencies ??= {}

const bundles = manifest.dsh.profile.bundles
if (!bundles.includes(PLUGIN)) bundles.push(PLUGIN)
manifest.dependencies[PLUGIN] = `file:${sourceDir.replace(/\\/g, '/')}`

if (!args.dryRun) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`[2/4] package.json 已登记（bundles: ${bundles.join(', ')}）`)

// ---------- 3. cordis.patch.yml ----------
const patchRow = `- insert:\n    - id: ${PLUGIN}\n      name: '${PLUGIN}'\n`
const patchText = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
if (patchText.includes(`id: ${PLUGIN}`)) {
  console.log('[3/4] cordis.patch.yml 已含插件行，跳过')
} else if (!args.dryRun) {
  const backup = `${patchPath}.bak-acrylic-${Date.now()}`
  if (existsSync(patchPath)) copyFileSync(patchPath, backup)
  const separator = patchText === '' || patchText.endsWith('\n') ? '' : '\n'
  writeFileSync(patchPath, `${patchText}${separator}\n${patchRow}`, 'utf8')
  console.log(`[3/4] cordis.patch.yml 已追加插件行（备份 ${backup}）`)
} else {
  console.log('[3/4] 试运行：将追加插件行')
}

// ---------- 4. 窗口材质补丁 ----------
if (args.skipAsar) {
  console.log('[4/4] 跳过 app.asar 补丁')
  process.exit(0)
}

const nodeExe = process.execPath
const patcher = join(HERE, 'patch-asar.mjs')
try {
  const out = execFileSync(nodeExe, [patcher, '--asar', args.asar, '--material', args.material, ...(args.dryRun ? ['--dry-run'] : [])], { encoding: 'utf8' })
  process.stdout.write(out.replace(/^/gm, '      '))
  console.log('[4/4] 窗口材质补丁已应用')
} catch (error) {
  const text = `${error.stdout ?? ''}${error.stderr ?? ''}`
  if (/EBUSY|EPERM|被占用|resource busy/iu.test(text)) {
    console.error('[4/4] app.asar 正被占用 —— DSH 还在运行')
    process.exit(3)
  }
  console.error('[4/4] 补丁失败：')
  console.error(text)
  process.exit(1)
}
