/** The voucher demo runs the repo's channel scripts with a local key file, so it only works on a developer machine. */
export const LOCAL_ONLY = 'This demo runs on your own laptop.';

/** On Vercel (preview or production) the demo cannot run. */
export function voucherDemoHosted(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VERCEL);
}
