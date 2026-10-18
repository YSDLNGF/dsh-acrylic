# dsh-acrylic

> DeepSeek Harness 桌面版的**透明轻薄亚克力**主题。  
> 窗口透出桌面壁纸，由 Windows 系统 Acrylic 材质负责模糊；页面分层雾面，输入栏与浮层保持可读。

[效果](#效果) · [安装](#安装) · [调参](#调参) · [卸载](#卸载) · [已知限制](#已知限制)

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

---

## 安装

分两步，**第一步在界面点几下就行，第二步才需要命令行**。

### 第 1 步：用 Harness 自带的「添加插件」

> ⚠️ **顺序很重要**：先做这一步，DSH 会自行处理依赖与重启。
> 做完它，插件已经能跑，页面那半边（透明、雾面、提亮文字）立即生效。

1. 打开 Harness → **设置**
2. 进入 **插件** → **插件市场**
3. 点 **「添加插件」** 按钮（一般在市场页右上角）
4. 粘贴本仓库地址：
   ```
   https://github.com/YSDLNGF/dsh-acrylic
   ```
5. 确认安装。Harness 会 clone 到
   `~/.dsh/profiles/desktop/node_modules/dsh-acrylic`、登记 `bundles`，然后提示重启

重启后进入 **设置 → 通用 → 透明亚克力**，看到滑块就说明成功了。

> **为什么搜索框里可能搜不到？**
> 插件市场的内容来自目录文件 `plugins.json`，托管在
> [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 仓库。
> 一个插件要被搜到，必须先向那个仓库提交 PR 收录（见下方「上架到插件市场」）。
> **收录之前**，用上面的「添加插件」直接贴 GitHub 地址即可，
> 功能完全一样，只是没有市场详情页和评分。

### 上架到插件市场的状态

本插件已按官方 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)
的要求准备好仓库结构：

| 要求 | 状态 |
| --- | --- |
| 根 `package.json` 声明 `dsh.bundle` | ✅ 已声明 `./plugin/cordis.patch.yml` |
| 仓库有真实可用代码 | ✅ |
| `screenshots.json`（市场展示截图） | ✅ `assets/screenshot-1.png` |
| 分类 | `theme`（会进入市场的「主题」Tab，支持一键安装/切换/卸载） |
| 仓库 topic `dsh-plugin` | 需要在 GitHub 仓库设置里添加 |
| 仓库创建满 1 天 | 由官方 CI 自动检查 |

收录方式是向
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
提一个只含单个文件的 PR：

```
data/plugins/YSDLNGF__dsh-acrylic.yml
```

```yaml
url: https://github.com/YSDLNGF/dsh-acrylic
name: YSDLNGF/dsh-acrylic
category: theme
description:
  en: Windows Acrylic window material plus layered frosted panels for the DeepSeek Harness desktop app.
  zh: DeepSeek Harness 桌面版的 Windows 亚克力窗口材质与分层雾面效果。
```

合并后官网自动重建，市场里就能搜到了。

### 第 2 步：让窗口透出壁纸（这一步仍需命令行）

第 1 步只让页面半透明，但窗口本身还是不透明的 —— 壁纸透不出来。
窗口材质是 Electron `BrowserWindow` 的**构造参数**，只存在于主进程，
插件（运行在渲染进程侧）碰不到窗口对象，所以必须改 `app.asar`。

这与现有同类插件（如 [dsh-desktop-glass](https://github.com/JianHeShui/dsh-desktop-glass)）
的处境相同，没有纯插件方案。

```powershell
cd dsh-acrylic
powershell -ExecutionPolicy Bypass -File .\apply-when-closed.ps1
```

这个脚本会：

1. 等你从托盘退出 Harness（它监测 `app.asar` 锁释放）
2. 自动给 `app.asar` 打**等字节补丁**（主窗口加 `backgroundMaterial: acrylic`）
3. 自动重启 Harness

**你只需要退出一次，剩下它自己完成。** 不会用命令行的话，
也可以照着下面「手动」小节做。

安装完成后，窗口就能透出壁纸了。

---

## 卸载

**只卸载插件（保留窗口补丁）**：在插件市场里点本插件的「卸载」按钮即可。

**连同窗口材质一起还原**：

```powershell
node uninstall.mjs
powershell -ExecutionPolicy Bypass -File .\restore-asar.ps1
```

两者都做完再重启，恢复原生外观。

---

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

---

## 已知限制

- **窗口材质补丁在 Harness 更新后失效**。更新会覆盖 `app.asar`，
  重跑一次 `apply-when-closed.ps1` 即可。
- **插件市场搜索**：需先向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin)
  提交 PR 收录。收录前请用「添加插件」按钮直接贴仓库地址安装。
- **改的是宿主程序**。请自行评估风险；本仓库提供备份与还原路径，
  且补丁脚本在锚点不匹配时会直接退出、不动已安装文件。
- **Acrylic 失焦会变实**。Windows 降级材质行为，无法绕过。
  介意可改用 `-Material mica`。

---

## 需要自己编译安装吗

不需要。本仓库是**即插即用**的 DSH 插件，不是需要 build 的前端项目：

| 文件 | 作用 | 需要编译吗 |
| --- | --- | --- |
| `package.json` | 根 manifest（声明 `dsh.bundle`，供市场/命令行安装） | ❌ |
| `plugin/` | 插件本体（页面半边） | ❌ 直接复制 |
| `patch-asar.mjs` | 改 `app.asar` 的工具 | ❌ Node 直接跑 |
| `apply-when-closed.ps1` | 自动化：等退出→打补丁→重启 | ❌ |
| `install.mjs` / `uninstall.mjs` | 命令行方式装卸 | ❌ |

用 Node 18+ 和 PowerShell 即可，**没有构建步骤**。

---

## 致谢

**这一版由 AI 编写。**

具体来说：从"我想让 harness 有透明轻薄亚克力效果"这句话开始，
确认需求、逆向 `main.js` 里的窗口参数、发现 `backgroundColor` 与
`backgroundMaterial` 互斥、逐层定位"发灰"来源、把侧栏收起按钮
位移的 bug 定位到 `backdrop-filter` 创建包含块、到最后的分层雾面方案，
全部由 AI Agent 与用户协作完成 —— 包括 `plugin/client.js` 里的每一条规则、
每一个数值、以及这几百行中文注释。

AI 在这个项目里也走了不少弯路：曾经连续多轮在错误假设上打转
（以为调 `backdrop-filter` 的 blur 值就能糊掉背后的文字），
直到做像素测量才发现它根本没有生效。这些失败结论也一并写进了注释，
因为**知道什么行不通，和知道什么行得通同样有用**。

如果你也在做类似的事，希望这个仓库能替你省掉那些来回试错的夜晚。

踩过的坑都写在代码注释和「已知限制」里，欢迎提交 Issue 或 PR。

## License

[MIT](./LICENSE)
