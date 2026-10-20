/**
 * install.mjs —— 安装 dsh-acrylic-light，**走 DSH 官方同一条 pnpm 路径**。
 *
 * ⚠ 这个文件重写过一次，原因值得记下来：
 *
 *   旧版是「手动复制文件 + 手写 package.json 的 dependencies」。
 *   结果 `package.json` 里出现了一条 `file:E:/...` 依赖，
 *   而 `pnpm-lock.yaml` 里**根本没有这条记录**（因为没跑过 pnpm）。
 *   于是官方卸载按钮执行 `pnpm remove dsh-acrylic-light` 时，
 *   pnpm 面对"package.json 说有依赖、lock 里却没有"的状态直接失败，
 *   卸载按钮就卡住了 —— 这就是"官方卸载卸不掉"的真正原因。
 *
 *   新版改成：把插件当作一个**标准 npm 包**交给 pnpm 安装，
 *   由 pnpm 自己写 package.json 与 pnpm-lock.yaml。
 *   这样官方卸载（pnpm remove）能正常走完，不再需要额外脚本。
 *
 * 做法：
 *   1. 把 plugin/ 打包成一个本地 .tgz（等价于 npm pack）
 *   2. 在 profile 目录执行 `pnpm add <tgz>`，由 pnpm 维护依赖与 lock
 *   3. 把 bundle 登记进 dsh.profile.bundles（这一步官方也是手写的）
 *   4. 把插件行写进 cordis.patch.yml（官方同样如此）
 *   5. 可选：给 app.asar 打窗口材质补丁
 *
 * 用法：
 *   node install.mjs [--profile <dir>] [--asar <app.asar>] [--skip-asar] [--dry-run]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = 'dsh-acrylic-light'
const SOURCE = join(HERE, 'plugin')

/** 插件包需要的文件（相对 plugin/）。 */
const PACK_FILES = ['package.json', 'index.js', 'client.js', 'cordis.patch.yml']

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
    skipAsar: false,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i]
    if (t === '--profile') out.profile = argv[++i]
    else if (t === '--asar') out.asar = argv[++i]
    else if (t === '--skip-asar') out.skipAsar = true
    else if (t === '--dry-run') out.dryRun = true
    else if (t === '--help' || t === '-h') {
      console.log('用法: node install.mjs [选项]')
      console.log('  --profile <目录>  指定 DSH profile（默认 ~/.dsh/profiles/desktop）')
      console.log('  --asar <路径>     指定 app.asar')
      console.log('  --skip-asar       跳过窗口材质补丁')
      console.log('  --dry-run         只显示将做什么')
      process.exit(0)
    } else throw new Error(`未知参数: ${t}`)
  }
  return out
}

/**
 * 把 plugin/ 目录打成 .tgz（npm pack 的最小等价实现）。
 *
 * ⚠ 这个 tgz 必须放在**持久位置**，不能是临时目录。
 *   教训：第一版把它放在 profile/.dsh-acrylic-tmp/ 并在安装后删掉，
 *   结果 package.json 和 pnpm-lock.yaml 里留下了指向已删除文件的路径，
 *   下次任何 pnpm 操作都会失败 —— 比原来的问题更糟。
 *
 *   现在放进 profile/node_modules/.dsh-acrylic-cache/，
 *   它随插件一起存在，卸载时由 uninstall 一并清理。
 */
function packPlugin(outDir) {
  mkdirSync(outDir, { recursive: true })

  const files = []
  for (const name of PACK_FILES) {
    const full = join(SOURCE, name)
    if (!existsSync(full)) throw new Error(`缺少插件文件：${full}`)
    files.push({ name: `package/${name}`, data: readFileSync(full) })
  }

  // 每个条目：512 字节 tar header + 内容（补齐到 512 的倍数）
  const blocks = []
  for (const f of files) {
    const header = Buffer.alloc(512)
    header.write(f.name, 0, 100, 'utf8')          // name
    header.write('0000644', 100, 8, 'utf8')        // mode
    header.write('0000000', 108, 8, 'utf8')        // uid
    header.write('0000000', 116, 8, 'utf8')        // gid
    header.write(`${f.data.length.toString(8).padStart(11, '0')} `, 124, 12, 'utf8') // size
    header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')} `, 136, 12, 'utf8') // mtime
    header.write('        ', 148, 8, 'utf8')       // checksum 占位
    header.write('0', 156, 1, 'utf8')              // typeflag: 普通文件
    header.write('ustar\0', 257, 6, 'utf8')
    header.write('00', 263, 2, 'utf8')

    // 计算校验和
    let sum = 0
    for (let i = 0; i < 512; i += 1) sum += header[i]
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8')

    blocks.push(header, f.data)
    const pad = (512 - (f.data.length % 512)) % 512
    if (pad) blocks.push(Buffer.alloc(pad))
  }
  // 结尾两个空块
  blocks.push(Buffer.alloc(1024))

  const tar = Buffer.concat(blocks)
  const gz = gzipSync(tar, { level: 9 })

  const manifest = JSON.parse(readFileSync(join(SOURCE, 'package.json'), 'utf8'))
  const tgz = join(outDir, `${PLUGIN}-${manifest.version}.tgz`)
  writeFileSync(tgz, gz)
  return tgz
}

/** 找可用的 pnpm 可执行文件。 */
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

const args = parseArgs(process.argv.slice(2))
const profileDir = resolve(args.profile)
const manifestPath = join(profileDir, 'package.json')
const patchPath = join(profileDir, 'cordis.patch.yml')

if (!existsSync(join(SOURCE, 'package.json'))) {
  console.error(`找不到插件源 ${SOURCE}`)
  process.exit(2)
}
if (!existsSync(manifestPath)) {
  console.error(`找不到 profile ${manifestPath}`)
  process.exit(2)
}

const tag = args.dryRun ? '[试运行] ' : ''

// ---------- 1. 打包 ----------
/* tgz 放在 profile/node_modules 下的固定缓存目录：
   它是 package.json 里 file: 依赖指向的真实文件，删掉会让 pnpm 失效。 */
const cacheDir = join(profileDir, 'node_modules', '.dsh-acrylic-cache')
let tgz
if (args.dryRun) {
  console.log(`[1/5] ${tag}将把 plugin/ 打包成 .tgz`)
} else {
  tgz = packPlugin(cacheDir)
  console.log(`[1/5] 已打包：${tgz.split(/[\\/]/).slice(-2).join('/')} (${(statSync(tgz).size / 1024).toFixed(1)} KB)`)
}

// ---------- 2. 用 pnpm 安装 ----------
const pnpm = findPnpm()
if (!pnpm) {
  console.error('[2/5] 找不到 pnpm —— 无法走官方安装路径')
  console.error('      请设置 PNPM_PATH 环境变量，或改用：设置 → 插件 → 添加插件')
  process.exit(2)
}

if (args.dryRun) {
  console.log(`[2/5] ${tag}将在 ${profileDir} 执行 pnpm add <tgz>`)
} else {
  const nodeExe = process.execPath
  try {
    execFileSync(nodeExe, [pnpm, 'add', tgz, '--config.confirmModulesPurge=false'], {
      cwd: profileDir,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 180000,
    })
    console.log('[2/5] pnpm add 完成（依赖与 lock 已由 pnpm 维护）')
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`
    console.error('[2/5] pnpm add 失败：')
    console.error(text.slice(-2000))
    process.exit(1)
  }
}

// ---------- 3. 登记 bundle ----------
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= []
if (!manifest.dsh.profile.bundles.includes(PLUGIN)) {
  manifest.dsh.profile.bundles.push(PLUGIN)
  if (!args.dryRun) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`[3/5] 已登记到 bundles`)
} else {
  console.log('[3/5] bundles 已包含，跳过')
}

// ---------- 4. cordis.patch.yml：**不要**手动插入 ----------
/*
  ⚠ 这里是"官方卸载报 bundle-in-use"的真正根因，务必别再加回去。

  插件包自己的 plugin/cordis.patch.yml 已经声明了：
      - insert:
          - id: dsh-acrylic-light
            name: 'dsh-acrylic-light'
  而 package.json 的 dsh.bundle.patch 指向它 —— DSH 加载 bundle 时会自动读这份 patch，
  自动把插件插进补丁层。

  旧版 install.mjs 又在 profile 的 cordis.patch.yml 里手动插了一遍，
  结果同一个 id 出现两次、来自两个来源：
    · 插件包的 patch（卸载时随包一起消失）
    · profile 的 patch（卸载时 DSH 只清掉它自己管理的那份）
  于是 loader 里始终残留一个引用本插件 id 的 fiber，
  removeBundle 的检查
      contributions.some(row => row.id === entry.options.id && row.name === entry.options.name)
  永远命中 → throw new ManagementFailure("bundle-in-use")
  → 界面上就是"其他配置仍在使用这个组合包的组件，请先停用它们"。

  所以：**profile 的 cordis.patch.yml 不插任何东西**。
  顺带把历史版本留下的重复行清掉（幂等，没有就跳过）。
*/
const patchText = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
if (patchText.includes(`id: ${PLUGIN}`)) {
  if (args.dryRun) {
    console.log(`[4/5] ${tag}将从 cordis.patch.yml 移除重复插入行（插件包自带 patch 已足够）`)
  } else {
    const lines = patchText.split(/\r?\n/)
    const out = []
    let removed = 0
    for (let i = 0; i < lines.length; i += 1) {
      if (/^\s*-\s*insert:\s*$/.test(lines[i]) && (lines[i + 1] ?? '').includes(`id: ${PLUGIN}`)) {
        i += 1
        while (i + 1 < lines.length && /^\s{4,}/.test(lines[i + 1])) i += 1
        removed += 1
        continue
      }
      out.push(lines[i])
    }
    if (removed > 0) {
      const backup = `${patchPath}.bak-acrylic-${Date.now()}`
      copyFileSync(patchPath, backup)
      writeFileSync(patchPath, out.join('\n'), 'utf8')
      console.log(`[4/5] 已移除 ${removed} 条重复插入行（插件包自带 patch 已足够）`)
    } else {
      console.log('[4/5] cordis.patch.yml 无需清理')
    }
  }
} else {
  console.log('[4/5] cordis.patch.yml 不插入插件行（由插件包自带 patch 负责）')
}

/* ⚠ 刻意**不删** tgz：package.json 与 pnpm-lock.yaml 里的 file: 依赖
   指向它，删掉会让下一次 pnpm 操作直接失败。
   它放在 node_modules/.dsh-acrylic-cache/ 下，体积约 13KB，
   卸载时由 uninstall-all.mjs 一并清理。 */

// ---------- 5. 窗口材质 ----------
if (args.skipAsar) {
  console.log('[5/5] 跳过 app.asar 补丁')
  console.log('')
  console.log('[完成] 插件已安装。请重启 DeepSeek Harness 生效。')
  process.exit(0)
}

const patcher = join(HERE, 'patch-asar.mjs')
try {
  const out = execFileSync(process.execPath, [patcher, '--asar', args.asar, ...(args.dryRun ? ['--dry-run'] : [])], { encoding: 'utf8' })
  process.stdout.write(out.replace(/^/gm, '      '))
  console.log('[5/5] 窗口材质补丁已应用')
} catch (error) {
  const text = `${error.stdout ?? ''}${error.stderr ?? ''}`
  if (/EBUSY|EPERM|被占用|resource busy/iu.test(text)) {
    console.error('[5/5] app.asar 正被占用 —— DSH 还在运行，跳过')
    console.error('      重启后窗口材质不会生效；如需补丁请退出 DSH 后重跑')
  } else {
    console.error('[5/5] 补丁失败：')
    console.error(text.slice(-1500))
  }
}

console.log('')
console.log('[完成] 请重启 DeepSeek Harness 生效。')
console.log('      卸载请用官方「设置 → 插件 → 卸载」，或 node uninstall-all.mjs')
