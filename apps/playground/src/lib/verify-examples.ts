/** Real devnet examples for /verify. Each was checked on devnet before being listed here (see
 * docs/PROGRESS.md for how): change them only to other real, verified values. */
export const VERIFY_EXAMPLES = {
  proven: {
    label: 'A proven payment',
    hint: '$40.00, human-approved, anchored on-chain',
    tx: '4RnVyRNTcssW1kAv9dL8xjbbhF8Ft6ZGomv7Msr1NGrTSgLKjQNafDcuK3B34ZVvmHYjhkfH78xZvG5PE5RiR1rU',
  },
  blocked: {
    label: 'A blocked attempt',
    hint: 'a prompt-injected agent tried to pay a stranger',
    decision: 'dec_01M4DCM6QVB8HF8QX6399TAK9K',
  },
  random: {
    label: 'A random devnet USDC transfer',
    hint: 'someone else’s payment, no Atlas Rail involved',
    tx: '5B2VfvVTNXNpWpTvCH3pbzETSe5UWrJ6h1yyMMGQ1Y5tadXASBCSHHpHcv6KNMtawVvk5xGgyETR9h7EywSoczog',
  },
} as const;
