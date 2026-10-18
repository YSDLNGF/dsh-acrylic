/**
 * verify-asar.mjs —— 校验 app.asar 里的窗口材质补丁是否真的就位。
 *
 * 只读，不修改任何文件。用来在重启前确认"这次值得重启"，
 * 避免反复试错却不知道补丁有没有落进去。
 *
 * 用法：node verify-asar.mjs --asar <app.asar>
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const asarArg = args[args.indexOf('--asar') + 1]
if (asarArg === undefined) {
  console.error('用法: node verify-asar.mjs --asar <app.asar>')
  process.exit(2)
}
const asarPath = resolve(asarArg)

const buffer = readFileSync(asarPath)
const headerDataSize = buffer.readUInt32LE(4)
const jsonSize = buffer.readUInt32LE(12)
const header = JSON.parse(buffer.subarray(16, 16 + jsonSize).toString('utf8'))
const dataStart = 8 + headerDataSize

const entry = header.files.lib.files['main.js']
const start = dataStart + Number(entry.offset)
const main = buffer.subarray(start, start + entry.size).toString('utf8')

const checks = [
  ['主窗口分支有 backgroundMaterial', /process\.platform === "win32" && primary \? \{[\s\S]{0,300}?backgroundMaterial: "(?:acrylic|mica|tabbed|auto)"/u.test(main)],
  ['主窗口分支无透明 backgroundColor', !/process\.platform === "win32" && primary \? \{[\s\S]{0,200}?backgroundColor: "#00000000"/u.test(main)],
  ['标题栏 overlay 已透明', /titleBarOverlay: \{\s*height: \d+,\s*color: "#00000000",/u.test(main)],
]

let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed += 1
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`)
}

// 顺带确认 asar 结构完好：条目大小与头部一致。
// 注意必须比字节数：main.js 里有中文注释，字符数不等于字节数。
const mainBytes = Buffer.byteLength(main, 'utf8')
const okSize = Number(entry.size) === mainBytes
console.log(`${okSize ? 'OK  ' : 'FAIL'} main.js 大小与头部记录一致（${entry.size} vs ${mainBytes}）`)
if (!okSize) failed += 1

console.log('')
console.log(failed === 0 ? '补丁已就位，可以重启验证' : `有 ${failed} 项不符合，别重启`)
process.exit(failed === 0 ? 0 : 1)
