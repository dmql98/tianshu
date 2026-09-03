import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// providerStore / schema 等模块在 import 时立即调用 getDataDir()（模块顶层副作用），
// 必须保证在任何测试模块加载前已存在数据目录。CI 是干净检出，没有
// web/server/config.json（未跟踪，仅本机开发时存在），否则 loadConfig 直接抛错。
if (!process.env.TIANSHU_DATA_DIR && !process.env.DATA_DIR) {
  process.env.TIANSHU_DATA_DIR = mkdtempSync(join(tmpdir(), 'tianshu-test-'))
}
// 测试进程默认跳过排他服务器锁：大量用例共享/接力同一个 dataDir，
// 锁会让并行与顺序用例（尤其 ipc-contract 的 fork 子进程）误伤。
// 锁自身的单元测试显式重新开启（见 server-lock.test.ts）。
if (!process.env.TIANSHU_DISABLE_SERVER_LOCK) {
  process.env.TIANSHU_DISABLE_SERVER_LOCK = '1'
}
