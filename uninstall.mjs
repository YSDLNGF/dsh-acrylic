/**
 * uninstall.mjs —— 移除 dsh-acrylic-light 插件（install.mjs 的逆操作）
 *
 * 做三件事（幂等，可重复执行）：
 *   1. 删除 <profile>/node_modules/dsh-acrylic-light
 *   2. 从 <profile>/package.json 移除 bundle 条目与依赖声明
 *   3. 从 <profile>/cordis.patch.yml 移除插入行
 *
 * ⚠ 它**不会**还原 app.asar 的窗口材质补丁 —— 那要用 restore-asar.ps1。
 *
 * 用法：node uninstall.mjs [--profile <目录>] [--dry-run]
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PLUGIN = 'dsh-acrylic-light'

function parseArgs(argv) {
  const out = { profile: undefined, dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--dry-run') out.dryRun = true
    else if (token === '--profile') out.profile = argv[++i]
    else throw new Error(`未知参数: ${token}`)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const profileDir = resolve(args.profile ?? (process.env.DSH_HOME
  ? join(process.env.DSH_HOME, 'profiles', 'desktop')
  : join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop')))
const targetDir = join(profileDir, 'node_modules', PLUGIN)
const manifestPath = join(profileDir, 'package.json')
const patchPath = join(profileDir, 'cordis.patch.yml')

if (!existsSync(manifestPath)) {
  console.error(`找不到 profile ${manifestPath}`)
  process.exit(2)
}

// ---------- 1. 删除插件包 ----------
if (!existsSync(targetDir)) {
  console.log(`[1/3] 插件目录不存在，跳过：${targetDir}`)
} else if (!args.dryRun) {
  rmSync(targetDir, { recursive: true, force: true })
  console.log(`[1/3] 已删除插件目录：${targetDir}`)
} else {
  console.log(`[1/3] 试运行：将删除 ${targetDir}`)
}

// ---------- 2. package.json ----------
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const bundles = manifest.dsh?.profile?.bundles ?? []
const filtered = bundles.filter((name) => name !== PLUGIN)
let manifestChanged = filtered.length !== bundles.length
if (manifest.dependencies && PLUGIN in manifest.dependencies) {
  delete manifest.dependencies[PLUGIN]
  manifestChanged = true
}
if (manifest.dsh?.profile?.bundles) manifest.dsh.profile.bundles = filtered

if (manifestChanged && !args.dryRun) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}
console.log(manifestChanged
  ? `[2/3] package.json 已清理（剩余 bundles: ${filtered.join(', ') || '(无)'}）`
  : '[2/3] package.json 无本插件记录，跳过')

// ---------- 3. cordis.patch.yml ----------
const patchText = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
if (!patchText.includes(`id: ${PLUGIN}`)) {
  console.log('[3/3] cordis.patch.yml 无本插件行，跳过')
} else {
  // 删掉上面 3 行（- insert: / 两行缩进条目）
  const cleaned = patchText
    .replace(new RegExp(`\\n?[ \\t]*- insert:\\n[ \\t]*- id: ${PLUGIN}\\n[ \\t]*name: '${PLUGIN}'\\n`, 'g'), '\n')
    .replace(new RegExp(`\\n?[ \\t]*- insert:\\n[ \\t]*- id: ${PLUGIN}\\n[ \\t]*name: "${PLUGIN}"\\n`, 'g'), '\n')
  if (!args.dryRun) {
    const backup = `${patchPath}.bak-acrylic-uninstall-${Date.now()}`
    if (existsSync(patchPath)) {
      const { copyFileSync } = await import('node:fs')
      copyFileSync(patchPath, backup)
      console.log(`    备份：${backup}`)
    }
    writeFileSync(patchPath, cleaned, 'utf8')
  }
  console.log('[3/3] cordis.patch.yml 已移除插件行')
}

console.log('\n[完成] 插件已卸载。窗口材质补丁仍在，如需还原请运行 restore-asar.ps1')
console.log('      然后重启 DeepSeek Harness 生效。')
