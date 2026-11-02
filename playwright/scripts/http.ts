import { request } from 'node:https';
import { request as httpRequest } from 'node:http';

/** Minimal sessioned API client for seed/setup flows (cookie + CSRF). */
export class ApiClient {
  private cookie = '';
  private csrf = '';

  constructor(private baseUrl: string) {}

  private call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any; headers: Record<string, string | string[] | undefined> }> {
    return new Promise((resolvePromise, reject) => {
      const url = new URL(path, this.baseUrl);
      const isHttps = url.protocol === 'https:';
      const req = (isHttps ? request : httpRequest)(
        {
          method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
          headers: {
            'content-type': 'application/json',
            ...(this.cookie ? { cookie: this.cookie } : {}),
            ...(this.csrf ? { 'x-csrf-token': this.csrf } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const setCookies = res.headers['set-cookie'] ?? [];
            const cookieParts = (Array.isArray(setCookies) ? setCookies : [setCookies])
              .map((c) => c?.split(';')[0])
              .filter(Boolean) as string[];
            if (cookieParts.length) {
              const jar = new Map(this.cookie ? this.cookie.split('; ').map((c) => c.split('=') as [string, string]) : []);
              for (const c of cookieParts) {
                const [k, v] = c.split('=') as [string, string];
                jar.set(k, v);
                if (k === 'componode_csrf') this.csrf = v;
              }
              this.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
            }
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed: any;
            try { parsed = JSON.parse(text); } catch { parsed = text; }
            resolvePromise({ status: res.statusCode ?? 0, body: parsed, headers: res.headers });
          });
        },
      );
      req.on('error', reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  }

  get(path: string) { return this.call('GET', path); }
  post(path: string, body?: unknown) { return this.call('POST', path, body); }
  put(path: string, body?: unknown) { return this.call('PUT', path, body); }
  patch(path: string, body?: unknown) { return this.call('PATCH', path, body); }
  delete(path: string) { return this.call('DELETE', path); }

  async login(username: string, password: string): Promise<void> {
    // GET first so the CSRF cookie exists before the state-changing request.
    await this.get('/api/v1/auth/session');
    const res = await this.post('/api/v1/auth/login', { username, password });
    if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  async expectOk(res: { status: number; body: any }, what: string): Promise<any> {
    if (res.status >= 400) throw new Error(`${what} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }
}
