/** Terminal narration helpers for the demo. Colour is disabled when stdout is not a TTY or NO_COLOR is set. */

const enabled = process.stdout.isTTY === true && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
};

export const say = (line = '') => console.log(line);

export function scene(number: number, title: string, subtitle: string): void {
  say();
  say(c.magenta('━'.repeat(78)));
  say(`${c.bold(c.magenta(`SCENE ${number}`))}  ${c.bold(title)}`);
  say(c.dim(subtitle));
  say(c.magenta('━'.repeat(78)));
}

export const step = (line: string) => say(`  ${c.cyan('▸')} ${line}`);
export const ok = (line: string) => say(`  ${c.green('✔')} ${line}`);
export const bad = (line: string) => say(`  ${c.red('✖')} ${line}`);
export const info = (line: string) => say(`  ${c.dim(line)}`);
export const kv = (key: string, value: string) => say(`    ${c.dim(key.padEnd(16))} ${value}`);

/** USDC base units (6 decimals) as "$12.34". */
export function usd(baseUnits: string): string {
  const n = BigInt(baseUnits);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `$${whole}.${frac}`;
}

export const short = (value: string, lead = 6, trail = 6) => (value.length > lead + trail + 1 ? `${value.slice(0, lead)}…${value.slice(-trail)}` : value);
