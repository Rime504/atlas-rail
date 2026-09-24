/** Minimal HTTP client for the Atlas Rail console API, used by the demo to act as the human roles. */
export class ConsoleApi {
  private readonly tokens = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async login(email: string, password: string): Promise<string> {
    const cached = this.tokens.get(email);
    if (cached) return cached;
    const res = await this.raw<{ accessToken: string }>('POST', '/v1/auth/login', undefined, { email, password });
    this.tokens.set(email, res.accessToken);
    return res.accessToken;
  }

  get<T>(path: string, auth: { token?: string; apiKey?: string }): Promise<T> {
    return this.raw<T>('GET', path, auth);
  }

  post<T>(path: string, auth: { token?: string; apiKey?: string }, body?: unknown): Promise<T> {
    return this.raw<T>('POST', path, auth, body);
  }

  private async raw<T>(method: string, path: string, auth?: { token?: string; apiKey?: string }, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json'; // Fastify rejects an empty body that claims to be JSON
    if (auth?.token) headers.authorization = `Bearer ${auth.token}`;
    if (auth?.apiKey) headers['x-api-key'] = auth.apiKey;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (error) {
      throw new Error(`Cannot reach the Atlas Rail API at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const message = (json as { message?: string | string[] } | null)?.message;
      throw new Error(`${method} ${path} → ${res.status}: ${Array.isArray(message) ? message.join('; ') : (message ?? text.slice(0, 200))}`);
    }
    return json as T;
  }
}

export const DEMO_PASSWORD = 'ChangeMe_AtlasRail_DevOnly';
export const DEMO_USERS = {
  owner: 'owner@atlasrail.local',
  approver: 'approver1@atlasrail.local',
} as const;
