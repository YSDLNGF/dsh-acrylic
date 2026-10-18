# dsh-acrylic

> DeepSeek Harness 桌面版的**透明轻薄亚克力**主题。  
> 窗口透出桌面壁纸，由 Windows 系统 Acrylic 材质负责模糊；页面分层雾面，输入栏与浮层保持可读。

[原理](#原理) · [安装](#安装) · [调参](#调参) · [卸载](#卸载) · [已知限制](#已知限制)

---

## 效果

| 区域 | 表现 |
| --- | --- |
| 主面板 / 顶栏 | 完全透明，透出壁纸，模糊由系统 Acrylic 完成 |
| 侧栏 / 三列 | 极淡底色（8%–10%），保留层次 |
| 输入栏 | `rgb(16 18 22 / 92%)` 实色雾面，与背景明确分层 |
| 悬停预览 / 菜单 / 工具提示 | `rgb(20 22 28 / 18%)` + `blur(12px)` |
| 设置面板 / 对话框 | `rgb(26 28 34 / 78%)` + `blur(24px)` |
| 代码块 | `rgb(20 22 28 / 55%)`，保证长段可读 |

> 深色主题下文字会自动提亮：`label-primary/secondary/tertiary` 及底层
> `bluish-200/300/400/600/700` 一并改为白色系，否则深底上发灰。

## 原理

**关键约束：窗口材质无法只用插件实现。**

Windows 的 Acrylic / Mica 是 Electron `BrowserWindow` 的**构造参数**，只存在于主进程；而 DSH 插件运行在渲染进程侧，拿不到窗口对象。所以本仓库由两部分组成：

| 部分 | 位置 | 职责 |
| --- | --- | --- |
| **补丁器** | `patch-asar.mjs` | 给 `app.asar` 内的 `main.js` 补上窗口材质参数 |
| **插件** | `plugin/` | 页面那半边：分层雾面、提亮文字、可调参数 |

### 补丁器怎么做（等字节修补）

`app.asar` 内部是「头部 JSON + 各条目原始字节」，头部记录每个条目的 `offset` / `size` / `integrity`。若 `main.js` 变长，其后所有条目的 offset 都要重算，改动面极大。

因此 `patch-asar.mjs` 采用**等字节**修补：

1. 在主窗口 win32 分支插入 `backgroundMaterial: "acrylic"`；
2. 同时从一段真实 JSDoc 注释里裁掉等长字节配平；
3. 条目大小不变 → 头部 offset 全部保持原样，只更新该条目自身的 integrity 哈希。

**两处刻意的重要取舍**：

- **不加 `backgroundColor: "#00000000"`**。Electron 里显式设置透明背景色会与系统材质互斥，材质会被静默忽略（实测 `DWMWA_SYSTEMBACKDROP_TYPE` 始终为 0）。
- **标题栏 overlay 颜色保持 `transparent`**。实测证明 `titleBarOverlay.color` 支持 alpha：不透明近黑会让标题栏纯黑，半透明会发灰，只有 `transparent` 才是纯亚克力。

任何一步锚点不唯一、大小不匹配、哈希结构不符，都会直接抛错退出，绝不写出半成品。

### 页面层为什么这样分层

早期版本给每个容器都留一点 alpha，叠完接近不透明，观感发灰。现在改为**分层**：

- 需要通透的地方（主面板、顶栏）→ 完全透明；
- 需要读字的浮层 → **实色 + 百分比透明度**，不掺壁纸色，所以不会发灰。

> 关于「模糊背后的聊天文字」：理论上是 `backdrop-filter` 的职责，但在本项目的透明窗口里实测采样不到内容（逐带测量边缘梯度，输入区与正文同样锐利），试过伪元素、z-index、去 `isolation`、blur 加到 56px 均无变化。因此改用高不透明度雾面替代。这个结论记录在案，避免重复踩坑。

## 安装

前置：Node.js 18+（打补丁时会用 `node --check` 校验语法）。Windows 11 22H2+。

```powershell
git clone https://github.com/<你的账号>/dsh-acrylic.git
cd dsh-acrylic
```

### 1. 装插件（页面那半边）

```powershell
node install.mjs
```

它会把 `plugin/` 复制到 `<DSH_HOME>\profiles\desktop\node_modules\dsh-acrylic`，并登记 `bundles` 与 `dependencies`。

### 2. 打窗口材质补丁（需要重启）

补丁要求 `app.asar` 不被占用，也就是 DSH 必须已退出。用下面的脚本托管：**它会等你退出、自动打补丁、再重启 DSH**，你只需从托盘退出一次。

```powershell
# 用计划任务托管，保证 DSH 退出不会把它一起杀掉
powershell -ExecutionPolicy Bypass -File .\apply-when-closed.ps1
```

参数：

- `-Material acrylic` 换成 `mica`
- `-Asar <path>` / `-Exe <path>` 手动指定安装位置（默认自动探测）
- `-NoRestart` 只打补丁，不重启

打完后窗口即可透出壁纸。

> 若窗口不透，前往「设置 → 个性化 → 颜色」确认已开启透明效果。

## 调参

两种方式，均**实时生效，无需重启**：

**控制台**（F12 → Console）：

```js
glass()                      // 看当前参数
glass({ alpha: 92 })         // 浮层/输入栏厚度，越大越实
glass({ noise: 4 })          // 亚克力颗粒感
glass({ enabled: false })    // 一键关闭
glass.reset()                // 回默认
```

**设置页**：`设置 → 通用 → 透明亚克力`，带滑块。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `alpha` | 92 | 浮层与输入栏的雾面厚度。92 是实测最平衡的一档 |
| `noise` | 3.2 | 亚克力细微噪点，纯色平板没有"薄"感 |

改色值请直接编辑 `plugin/client.js` 顶部的 `GLASS_STYLE`，每个值旁都注明了由来。

## 卸载

```powershell
node uninstall.mjs
powershell -ExecutionPolicy Bypass -File .\restore-asar.ps1
```

`uninstall.mjs` 会移除 node_modules 里的插件、撤销 `bundles` 与 `dependencies` 登记；`restore-asar.ps1` 用备份还原 `app.asar`。

## 已知限制

- **Acrylic 失焦会变实**。Windows 降级材质行为，无法绕过。介意可用 `-Material mica`。
- **DSH 更新会覆盖 `app.asar`**，补丁随之失效。重跑一次 `apply-when-closed.ps1` 即可。
- **改动的是宿主程序**。请自行评估风险；本仓库提供备份与还原路径，且补丁脚本在锚点不匹配时会直接退出、不动已安装文件。
- **模糊不了背后的聊天文字**。原因见上文「页面层为什么这样分层」。

## 目录

```
plugin/               页面半部（客户端）
  index.js            宿主半部（空操作）
  client.js           样式注入 + 设置页 + 实时调参
  cordis.patch.yml    bundle patch
patch-asar.mjs        等字节 asar 补丁
verify-asar.mjs       校验补丁是否落位
install.mjs           安装插件
uninstall.mjs         卸载插件
apply-when-closed.ps1 等 DSH 退出 → 打补丁 → 重启
restore-asar.ps1      还原 app.asar
demo.html             本地效果预览页（不依赖 DSH）
```

## License

[MIT](./LICENSE)
