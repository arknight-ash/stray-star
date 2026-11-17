import { spawn, type ChildProcess } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 自检脚本共用的 dev server 启停（阶段 7 抽出）。
 *
 * 两处环境坑都在这里一次性处理，免得每个脚本各踩一遍：
 *  1. dev 启动要覆盖写 `.next/package.json`，本沙箱里覆盖已存在文件会被拦（EPERM）；
 *     只删这一个文件，不清整个 `.next`（那会让每次自检都白等一次全量编译）；
 *  2. 只 `proc.kill()` 杀不掉 next dev 的子进程（dev bundler 是独立的孙进程），
 *     残留的实例会一直占着 `.next` 与端口，让**下一个**脚本的 dev 起不来 ——
 *     症状是"上一个脚本全绿、这一个超时"，很容易误判成刚改的代码有问题。
 */

export async function startDev(
  port: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ChildProcess> {
  await rm(join(process.cwd(), '.next', 'package.json'), { force: true }).catch(() => undefined);
  const nextBin = join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  return spawn(process.execPath, [nextBin, 'dev', '-p', String(port), '--turbo'], {
    cwd: process.cwd(),
    env,
    stdio: 'ignore',
  });
}

export async function stopDev(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    /* 已经没了 */
  }
  // /T 连同子进程树一起结束：Windows 上 SIGTERM 只打到父进程
  if (process.platform === 'win32' && proc.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
    });
  }
}

/** 轮询等待服务就绪 */
export async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`服务未在 ${timeoutMs}ms 内就绪：${url}`);
}
