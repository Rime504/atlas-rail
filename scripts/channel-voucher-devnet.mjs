/**
 * Repo entry for the channel payment. The functions live in the atlasrails package.
 * Run from the repo root: node scripts/channel-voucher-devnet.mjs <fee-payer-address>
 */
import { pathToFileURL } from 'node:url';
import {
  askAtlasRail,
  deployedProgramElf,
  forgetVoucherSession,
  loadFeePayer,
  main,
  payerKeypair,
  resolvePayment,
  treasuryOwnerFromElf,
  voucherSessionPath,
} from '../packages/atlasrails/payment.mjs';

export {
  askAtlasRail,
  deployedProgramElf,
  forgetVoucherSession,
  loadFeePayer,
  main,
  payerKeypair,
  resolvePayment,
  treasuryOwnerFromElf,
  voucherSessionPath,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {

    if (error && Array.isArray(error.logs)) console.error(error.logs.join('\n'));
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
