const isDev = process.env.NODE_ENV !== 'production';

export const logger = {
  info: (msg: string, meta?: unknown) => {
    if (isDev) console.log(`[INFO] ${msg}`, meta ?? '');
  },
  warn: (msg: string, meta?: unknown) => {
    console.warn(`[WARN] ${msg}`, meta ?? '');
  },
  error: (msg: string, meta?: unknown) => {
    console.error(`[ERROR] ${msg}`, meta ?? '');
  },
  debug: (msg: string, meta?: unknown) => {
    if (isDev) console.debug(`[DEBUG] ${msg}`, meta ?? '');
  },
};