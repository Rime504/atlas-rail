export interface AtlasClientOptions {
  baseUrl: string;
  apiKey?: string;
  token?: string;
}

export class AtlasRailClient {
  private baseUrl: string;
  private apiKey?: string;
  private token?: string;

  constructor(options: AtlasClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.token = options.token;
  }

  private async request<T>(path: string, options: RequestInit = {}, headers: Record<string, string> = {}): Promise<T> {
    const authHeaders: Record<string, string> = {};
    if (this.apiKey) {
      authHeaders['x-api-key'] = this.apiKey;
    } else if (this.token) {
      authHeaders['authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...authHeaders,
        ...headers,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Atlas Rail API Error (${res.status}): ${errorText}`);
    }

    if (res.headers.get('content-type')?.includes('text/csv')) {
      return (await res.text()) as unknown as T;
    }

    return (await res.json()) as T;
  }

  public async getTreasuries(): Promise<any> {
    return this.request('/v1/treasuries');
  }

  public async createRecipient(data: any): Promise<any> {
    return this.request('/v1/recipients', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async createPayout(data: any, idempotencyKey: string): Promise<any> {
    return this.request('/v1/payouts', {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  public async getPayout(id: string): Promise<any> {
    return this.request(`/v1/payouts/${id}`);
  }

  public async approvePayout(id: string, comment?: string): Promise<any> {
    return this.request(`/v1/payouts/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    });
  }

  public async getLedger(): Promise<any> {
    return this.request('/v1/ledger');
  }

  public async exportReconciliationCsv(): Promise<string> {
    return this.request<string>('/v1/reconciliation/export.csv');
  }
}
