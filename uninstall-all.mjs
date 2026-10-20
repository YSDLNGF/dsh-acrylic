/**
 * uninstall-all.mjs —— 一键彻底卸载 dsh-acrylic-light。
 *
 * 为什么需要它：原来的卸载要两步 ——
 *   ① 设置里点卸载（或跑 uninstall.mjs）
 *   ② 再跑 restore-asar.ps1 还原窗口材质
 * 而且第②步必须开命令行、必须确保 DSH 已退出，很容易卡住。
 *
 * 这个脚本把两件事合成一步：
 *   1. 移除插件（目录 / package.json / cordis.patch.yml）
 *   2. 还原 app.asar 的窗口材质补丁
 *   3. 清理本插件留下的备份文件（可选，--keep-backups 保留）
 *   4. 打印明确的重启提示
 *
 * 设计要点：
 *   · 全程幂等 —— 重复跑不会出错，已经卸干净就报"无需操作"
 *   · 不碰别人的东西 —— 只处理本插件自己的条目和备份
 *   · 失败要说人话 —— app.asar 被占用时明确告诉用户"先退出 DSH"
 *
 * 用法：
 *   node uninstall-all.mjs                 # 卸载插件 + 还原窗口材质
 *   node uninstall-all.mjs --plugin-only   # 只卸插件，保留窗口材质
 *   node uninstall-all.mjs --dry-run       # 只看会做什么，不实际改
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 找可用的 pnpm 可执行文件（与 install.mjs 保持一致）。 */
function findPnpm() {
  const candidates = [
    process.env.PNPM_PATH,
    join(process.env.USERPROFILE ?? '', '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'),
  ].filter(Boolean)
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return undefined
}

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = 'dsh-acrylic-light'

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
    profile: process.env.DSH_HOME
      ? join(process.env.DSH_HOME, 'profiles', 'desktop')
      : join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop'),
    asar: detectAsar(),
    pluginOnly: false,
    dryRun: false,
    keepBackups: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i]
    if (t === '--profile') out.profile = argv[++i]
    else if (t === '--asar') out.asar = argv[++i]
    else if (t === '--plugin-only') out.pluginOnly = true
    else if (t === '--dry-run') out.dryRun = true
    else if (t === '--keep-backups') out.keepBackups = true
    else if (t === '--help' || t === '-h') {
      console.log('用法: node uninstall-all.mjs [选项]')
      console.log('  --profile <目录>   指定 DSH profile（默认 ~/.dsh/profiles/desktop）')
      console.log('  --asar <路径>      指定 app.asar')
      console.log('  --plugin-only      只卸插件，保留窗口材质补丁')
      console.log('  --dry-run          只显示将做什么，不实际修改')
      console.log('  --keep-backups     保留备份文件')
      process.exit(0)
    } else throw new Error(`未知参数: ${t}`)
  }
  return out
}

/**
 * 在多个位置寻找原始 app.asar 备份。
 *
 * 为什么要搜多个地方：补丁的历史备份散落在不同目录
 * （插件自己的 backups/、glass-v2/backups/、tools/backups/），
 * 只查一个地方就会"找不到备份"，用户只能手动还原 —— 这正是"卸载难"的来源。
 *
 * 判定"可用的备份"：文件大小与原版接近（>100MB）且小于等于当前 app.asar，
 * 避免把某个被改过的小文件误当备份。
 */
function findAsarBackup() {
  const candidates = []

  // 1) 插件自己的 backups/<时间戳>/app.asar
  const own = join(HERE, 'backups')
  if (existsSync(own)) candidates.push(own)

  // 2) 仓库里其他历史工具的备份目录
  for (const rel of ['..\\glass-v2\\backups', '..\\tools\\backups']) {
    const p = join(HERE, rel)
    if (existsSync(p)) candidates.push(p)
  }

  // 3) app.asar 旁边遗留的 .glass-original
  if (args.asar && existsSync(`${args.asar}.glass-original`)) {
    return `${args.asar}.glass-original`
  }

  const found = []
  for (const root of candidates) {
    let entries = []
    try {
      entries = readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse()
    } catch {
      continue
    }
    for (const name of entries) {
      const f = join(root, name, 'app.asar')
      if (!existsSync(f)) continue
      const size = statSync(f).size
      // 原版 app.asar 都是百 MB 级；太小的多半是别的东西
      if (size > 100 * 1024 * 1024) {
        found.push({ path: f, size, mtime: statSync(f).mtimeMs })
      }
    }
  }

  // 取最新的一份
  found.sort((a, b) => b.mtime - a.mtime)
  return found.length ? found[0].path : undefined
}

const args = parseArgs(process.argv.slice(2))
const profileDir = resolve(args.profile)
const pluginDir = join(profileDir, 'node_modules', PLUGIN)
const manifestPath = join(profileDir, 'package.json')
const patchPath = join(profileDir, 'cordis.patch.yml')

const tag = args.dryRun ? '[试运行] ' : ''
let didSomething = false

console.log('════════════════════════════════════════════════')
console.log('  dsh-acrylic-light 卸载' + (args.dryRun ? '（试运行，不修改任何文件）' : ''))
console.log('════════════════════════════════════════════════')
console.log(`profile: ${profileDir}`)
console.log('')

// ══════════════════════════════════════════════════════════
// 第 1 步：移除插件
// ══════════════════════════════════════════════════════════
console.log('【1/3】移除插件')

if (!existsSync(manifestPath)) {
  console.log(`  跳过：找不到 ${manifestPath}`)
} else {
  /* 1a. 优先走官方 pnpm remove —— 这是"官方卸载"同一条路径。
     新版 install.mjs 用 pnpm add 安装，所以 pnpm 认得这个包，
     remove 能干净地清掉 node_modules 条目与 lock 记录。
     只有 pnpm 不可用或失败时，才退回手动删除。 */
  const pnpm = findPnpm()
  const wasInstalledByPnpm = (() => {
    try {
      const lock = join(profileDir, 'pnpm-lock.yaml')
      return existsSync(lock) && readFileSync(lock, 'utf8').includes(PLUGIN)
    } catch {
      return false
    }
  })()

  let removedByPnpm = false
  if (pnpm && wasInstalledByPnpm) {
    if (args.dryRun) {
      console.log(`  ${tag}将执行 pnpm remove ${PLUGIN}`)
      removedByPnpm = true
      didSomething = true
    } else {
      try {
        execFileSync(process.execPath, [pnpm, 'remove', PLUGIN, '--config.confirmModulesPurge=false'], {
          cwd: profileDir,
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 120000,
        })
        console.log('  已通过 pnpm remove 移除（官方同一条路径）')
        removedByPnpm = true
        didSomething = true
      } catch (error) {
        const text = `${error.stdout ?? ''}${error.stderr ?? ''}`
        console.log('  pnpm remove 失败，退回手动删除')
        if (text.trim()) console.log('    ' + text.trim().split('\n').slice(-3).join('\n    '))
      }
    }
  }

  // 1b. 手动兜底：目录 + 缓存 tgz
  if (!removedByPnpm && existsSync(pluginDir)) {
    if (!args.dryRun) rmSync(pluginDir, { recursive: true, force: true })
    console.log(`  ${tag}已删除插件目录`)
    didSomething = true
  } else if (removedByPnpm) {
    // pnpm 删掉了链接，但缓存 tgz 还留着，一并清掉
    const cacheDir = join(profileDir, 'node_modules', '.dsh-acrylic-cache')
    if (existsSync(cacheDir)) {
      if (!args.dryRun) rmSync(cacheDir, { recursive: true, force: true })
      console.log(`  ${tag}已清理 tgz 缓存`)
    }
  }

  // 1c. package.json（pnpm remove 通常会自己清，这里做兜底）
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  let changed = false
  if (manifest.dsh?.profile?.bundles?.includes(PLUGIN)) {
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((n) => n !== PLUGIN)
    changed = true
  }
  if (manifest.dependencies && PLUGIN in manifest.dependencies) {
    delete manifest.dependencies[PLUGIN]
    changed = true
  }
  if (changed) {
    if (!args.dryRun) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    console.log(`  ${tag}package.json 已清理`)
    didSomething = true
  } else {
    console.log('  package.json 无本插件记录')
  }
}

// 1c. cordis.patch.yml
if (existsSync(patchPath)) {  const text = readFileSync(patchPath, 'utf8')
  if (text.includes(`id: ${PLUGIN}`)) {
    // 稳妥做法：逐行扫描，删掉包含本插件 id 的 insert 块
    const lines = text.split(/\r?\n/)
    const out = []
    for (let i = 0; i < lines.length; i += 1) {
      // 命中 "- insert:" 且后面紧跟本插件 id → 整块跳过
      if (/^\s*-\s*insert:\s*$/.test(lines[i])) {
        const next1 = lines[i + 1] ?? ''
        if (next1.includes(`id: ${PLUGIN}`)) {
          // 跳过 insert 行 + 该条目后续所有缩进行
          i += 1
          while (i + 1 < lines.length && /^\s{4,}/.test(lines[i + 1])) i += 1
          continue
        }
      }
      out.push(lines[i])
    }
    if (!args.dryRun) {
      const backup = `${patchPath}.bak-acrylic-uninstall-${Date.now()}`
      copyFileSync(patchPath, backup)
      writeFileSync(patchPath, out.join('\n'), 'utf8')
      console.log(`  ${tag}cordis.patch.yml 已移除插件行（备份 ${backup.split(/[\\/]/).pop()}）`)
    } else {
      console.log(`  ${tag}cordis.patch.yml 将移除插件行`)
    }
    didSomething = true
  } else {
    console.log('  cordis.patch.yml 无本插件行')
  }
}

// ══════════════════════════════════════════════════════════
// 第 2 步：还原窗口材质补丁
// ══════════════════════════════════════════════════════════
console.log('')
console.log('【2/3】还原窗口材质')

if (args.pluginOnly) {
  console.log('  已指定 --plugin-only，保留窗口材质补丁')
} else if (!args.asar) {
  console.log('  跳过：找不到 app.asar（可用 --asar 指定）')
} else {
  const backup = findAsarBackup()

  if (!backup) {
    console.log('  跳过：找不到原始 app.asar 备份')
    console.log('        （说明本机可能没打过窗口材质补丁，无需还原）')
  } else {
    // 检查是否被占用：用 rename 探测（Windows 下最可靠）
    let locked = false
    try {
      const probe = `${args.asar}.probe-${Date.now()}`
      renameSync(args.asar, probe)
      renameSync(probe, args.asar)
    } catch {
      locked = true
    }

    const short = backup.split(/[\\/]/).slice(-3).join('/')
    if (locked) {
      console.log('  ⚠ app.asar 正被占用 —— DeepSeek Harness 还在运行')
      console.log('    请先从托盘完全退出 DSH，然后重跑本脚本')
      console.log(`    手动还原：Copy-Item "${backup}" "${args.asar}" -Force`)
    } else if (args.dryRun) {
      console.log(`  ${tag}将还原 app.asar`)
      console.log(`        备份来源：${short}`)
      didSomething = true
    } else {
      copyFileSync(backup, args.asar)
      console.log(`  app.asar 已还原为原始版本`)
      console.log(`        来源：${short}`)
      didSomething = true
    }
  }
}

// ══════════════════════════════════════════════════════════
// 第 3 步：清理备份（可选）
// ══════════════════════════════════════════════════════════
console.log('')
console.log('【3/3】清理备份')

if (args.keepBackups) {
  console.log('  已指定 --keep-backups，保留所有备份')
} else {
  const backupDir = join(HERE, 'backups')
  if (existsSync(backupDir)) {
    if (!args.dryRun) {
      rmSync(backupDir, { recursive: true, force: true })
      console.log('  已删除 backups/（app.asar 原始备份）')
    } else {
      console.log(`  ${tag}将删除 backups/`)
    }
    didSomething = true
  } else {
    console.log('  无 backups/ 目录')
  }

  // 清理 patch yml 的历史备份（只留最近 3 个）
  if (existsSync(profileDir)) {
    const baks = readdirSync(profileDir)
      .filter((n) => n.startsWith('cordis.patch.yml.bak-acrylic'))
      .sort()
      .reverse()
    if (baks.length > 3) {
      for (const old of baks.slice(3)) {
        if (!args.dryRun) rmSync(join(profileDir, old), { force: true })
      }
      console.log(`  已清理 ${baks.length - 3} 个旧的 cordis.patch.yml 备份`)
      didSomething = true
    }
  }
}

// ══════════════════════════════════════════════════════════
console.log('')
console.log('════════════════════════════════════════════════')
if (!didSomething) {
  console.log('  无需操作 —— 已经是干净状态')
} else if (args.dryRun) {
  console.log('  以上是试运行结果，未修改任何文件')
  console.log('  去掉 --dry-run 即可实际执行')
} else {
  console.log('  卸载完成')
  console.log('')
  console.log('  ⚠ 请完全退出 DeepSeek Harness 再重新打开，')
  console.log('    窗口材质与页面样式才会恢复原生。')
}
console.log('════════════════════════════════════════════════')
