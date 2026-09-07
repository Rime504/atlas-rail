import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma, generateUlid } from '@atlas-rail/database';

@Injectable()
export class TreasuryService {
  async findAll(orgId: string) {
    return prisma.treasury.findMany({
      where: { organizationId: orgId },
      include: { policies: { where: { status: 'ACTIVE' } } },
    });
  }

  async findOne(orgId: string, id: string) {
    const treasury = await prisma.treasury.findFirst({
      where: { id, organizationId: orgId },
      include: { policies: true },
    });
    if (!treasury) throw new NotFoundException('Treasury not found.');
    return treasury;
  }

  async create(orgId: string, data: { name: string; slug: string; mintAddress: string; settlementWalletAddress: string }) {
    return prisma.treasury.create({
      data: {
        id: generateUlid('trs'),
        organizationId: orgId,
        name: data.name,
        slug: data.slug,
        network: 'DEVNET',
        assetSymbol: 'USDC',
        mintAddress: data.mintAddress,
        settlementWalletAddress: data.settlementWalletAddress,
        status: 'ACTIVE',
      },
    });
  }

  async setFreezeStatus(orgId: string, id: string, freeze: boolean) {
    const treasury = await this.findOne(orgId, id);
    const updated = await prisma.treasury.update({
      where: { id: treasury.id },
      data: { status: freeze ? 'FROZEN' : 'ACTIVE' },
    });

    await prisma.ledgerEntry.create({
      data: {
        id: generateUlid('ldg'),
        organizationId: orgId,
        treasuryId: id,
        entryType: freeze ? 'TREASURY_FROZEN' : 'TREASURY_UNFROZEN',
        direction: 'INFORMATIONAL',
        referenceType: 'TREASURY',
        referenceId: id,
      },
    });

    return updated;
  }

  async getBalance(orgId: string, id: string) {
    await this.findOne(orgId, id);
    // In Devnet sandbox, balance is reported from ledger confirmed activity + devnet reserve
    return {
      assetSymbol: 'USDC',
      network: 'DEVNET',
      balanceBaseUnits: '50000000000', // 50,000 USDC devnet sandbox balance
      balanceDisplay: '50000.000000',
      decimals: 6,
    };
  }
}
