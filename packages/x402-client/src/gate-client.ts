import {
  ApprovalState,
  GateAuthorization,
  SignedAgentGateRequest,
  SignedDecision,
} from '@atlas-rail/mandate';
import { BoundReceipt, ReceiptResponse } from '@atlas-rail/receipt';
import { AtlasPaymentError } from './errors';

/** What the agent needs to know about a pending approval. */
export interface GateApprovalView {
  id: string;
  status: ApprovalState;
  expiresAt: number;
  requiredRoles: string[];
  comment?: string | null;
}

export interface GateResponse {
  decision: SignedDecision;
  authorization: GateAuthorization | null;
  approval: GateApprovalView | null;
  replayed?: boolean;
}

export interface IssueReceiptRequest {
  decisionId: string;
  txSignature: string;
  response: ReceiptResponse;
}

/** The agent-facing surface of Atlas Rail. Implemented over HTTP for production and in-process for tests. */
export interface GateClient {
  evaluate(request: SignedAgentGateRequest): Promise<GateResponse>;
  getApproval(approvalId: string): Promise<GateApprovalView>;
  issueReceipt(input: IssueReceiptRequest): Promise<BoundReceipt>;
}

export interface HttpGateClientOptions {
  /** Atlas Rail API base URL, e.g. http://localhost:3001 */
  baseUrl: string;
  /** Organisation API key (sent as `x-api-key`). */
  apiKey: string;
  fetch?: typeof fetch;
}

/** {@link GateClient} over the Atlas Rail REST API (`/v1/agent/gate/*`). */
export class HttpGateClient implements GateClient {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: HttpGateClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.doFetch = options.fetch ?? fetch;
  }

  evaluate(request: SignedAgentGateRequest): Promise<GateResponse> {
    return this.call<GateResponse>('POST', '/v1/agent/gate/evaluate', request);
  }

  getApproval(approvalId: string): Promise<GateApprovalView> {
    return this.call<GateApprovalView>('GET', `/v1/agent/gate/approvals/${encodeURIComponent(approvalId)}`);
  }

  issueReceipt(input: IssueReceiptRequest): Promise<BoundReceipt> {
    return this.call<BoundReceipt>('POST', '/v1/agent/gate/receipts', input);
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.doFetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-api-key': this.options.apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new AtlasPaymentError(
        'GATE_UNAVAILABLE',
        `Could not reach the Atlas Rail gate at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // fall through to the generic error below
    }
    if (!response.ok) {
      const message = (json as { message?: string | string[] } | null)?.message;
      throw new AtlasPaymentError(
        'GATE_UNAVAILABLE',
        `Atlas Rail gate returned ${response.status}: ${Array.isArray(message) ? message.join(', ') : (message ?? text.slice(0, 200))}`,
      );
    }
    return json as T;
  }
}
