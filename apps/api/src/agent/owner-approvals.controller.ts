import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SIGNATURE_SCHEME } from '@atlas-rail/mandate';
import { z } from 'zod';
import { defaultApprovals } from './channel-voucher';

const signatureSchema = z
  .object({
    scheme: z.literal(SIGNATURE_SCHEME).default(SIGNATURE_SCHEME),
    signer: z.string().min(32).max(44),
    signature: z.string().min(64).max(100),
  })
  .strict();

/**
 * Where the owner's or an approver's wallet signs an over-limit payment. No login: the wallet
 * signature is the credential, and only a key in the mandate's chain (never the agent) can approve.
 */
@ApiTags('owner approvals')
@Controller('v1/owner-approvals')
export class OwnerApprovalsController {
  @Get(':id')
  @ApiOperation({ summary: 'The exact text the wallet signs for one approval request, and who may sign it' })
  async get(@Param('id') id: string) {
    const approvals = defaultApprovals();
    if (!approvals) throw new ServiceUnavailableException('Owner approvals are off');
    const found = await approvals.toSign(id);
    if (!found) throw new NotFoundException('No such approval request');
    const { approval, terms, message } = found;
    return {
      id: approval.id,
      status: approval.status,
      reason: approval.reason,
      terms,
      message,
      scheme: SIGNATURE_SCHEME,
      signers: approval.signers,
    };
  }

  @Post(':id/signature')
  @HttpCode(200)
  @ApiOperation({ summary: "Approve one payment with the owner's or an approver's wallet signature over that text" })
  async sign(@Param('id') id: string, @Body() body: unknown) {
    const approvals = defaultApprovals();
    if (!approvals) throw new ServiceUnavailableException('Owner approvals are off');
    const parsed = signatureSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Body must be { scheme: "ed25519", signer, signature } in base58');
    const result = await approvals.submitSignature(id, parsed.data);
    if (!result.ok) throw new BadRequestException(result.reason);
    return { id, status: result.approval.status, decidedBy: result.approval.decidedBy };
  }
}
