/**
 * dsh-acrylic 的宿主半部。
 *
 * 真正的窗口材质由 app.asar 补丁写进 BrowserWindow 构造参数（见 patch-asar.mjs），
 * 页面层由 client.js 注入。宿主侧无需做任何事，只保留一个可加载的包。
 */
export const name = 'acrylic'

export async function apply() {
  // 无宿主侧工作。
}
