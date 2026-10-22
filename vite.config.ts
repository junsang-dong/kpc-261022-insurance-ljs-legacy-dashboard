import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * 로컬 개발용: Vercel Functions(`api/*.ts`)의 Web 표준 핸들러를 Vite dev 서버에서 그대로 실행한다.
 * 배포 환경에서는 Vercel이 같은 파일을 함수로 실행하므로 이 플러그인은 사용되지 않는다.
 */
function vercelApiDev(): Plugin {
  return {
    name: 'vercel-api-dev',
    configureServer(server) {
      const env = loadEnv('development', process.cwd(), '');
      for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const m = /^\/api\/(scan|ai)$/.exec(url.pathname);
        if (!m) return next();
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const request = new Request(url, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
          });
          const mod = await server.ssrLoadModule(`/api/${m[1]}.ts`);
          const handler = mod[req.method ?? 'POST'] as ((r: Request) => Promise<Response>) | undefined;
          if (!handler) {
            res.statusCode = 405;
            return res.end('Method Not Allowed');
          }
          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          if (!response.body) return res.end();
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'internal', message: (e as Error).message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), vercelApiDev()],
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
