/**
 * 结构化日志（不引第三方依赖，保持 seed / edge 环境都能直接跑）。
 * 输出单行 JSON，便于后续接日志系统；生产可替换为 pino。
 */
type Level = 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { info: 20, warn: 30, error: 50 };

function emit(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (ORDER[level] < ORDER[(process.env.LOG_LEVEL as Level) ?? 'info']) return;
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
};
