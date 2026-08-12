/**
 * get-userdata.cjs
 *
 * 由 scripts/dev-desktop.mjs 在开发模式下以 Electron 运行一次，
 * 输出 Electron 解析后的 userData 绝对路径（开发版与打包版共用同一
 * 默认数据根的关键：TIANSHU_CONFIG_DIR=<userData>、
 * TIANSHU_DEFAULT_DATA_DIR=<userData>/data）。
 *
 * 用法：electron scripts/get-userdata.cjs
 */
const { app } = require('electron')

// userData 在 app ready 之前即可解析；直接输出并退出。
process.stdout.write(app.getPath('userData'))
app.exit(0)
