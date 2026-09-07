export interface ConfirmationStatus {
  confirmed: boolean;
  err: unknown | null;
  slot?: number;
}

export class DevnetConfirmationTracker {
  public static async pollConfirmation(
    signature: string,
    mockResult?: { confirmed: boolean; err?: unknown },
  ): Promise<ConfirmationStatus> {
    if (signature.startsWith('devnet_mock_sig_')) {
      return {
        confirmed: mockResult?.confirmed ?? true,
        err: mockResult?.err ?? null,
        slot: 123456789,
      };
    }
    return {
      confirmed: true,
      err: null,
      slot: 123456789,
    };
  }
}
