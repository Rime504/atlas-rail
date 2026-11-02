import { describe, expect, it } from 'vitest';
import { demoRunFrame } from './agent-hooks';

describe('demoRunFrame', () => {
  it('keeps a narration line, the scene banner, and a failed exit', () => {
    expect(demoRunFrame('line', JSON.stringify({ stream: 'stdout', text: '✔ paid' }))).toEqual({
      kind: 'line',
      line: { stream: 'stdout', text: '✔ paid' },
    });
    expect(demoRunFrame('scene', JSON.stringify({ number: 4, title: 'Escalate' }))).toEqual({
      kind: 'scene',
      scene: { number: 4, title: 'Escalate' },
    });
    expect(demoRunFrame('error', JSON.stringify({ message: 'A demo run is already in progress' }))).toEqual({
      kind: 'error',
      line: { stream: 'stderr', text: 'A demo run is already in progress' },
      result: { ok: false, exitCode: 1 },
    });
    expect(demoRunFrame('done', JSON.stringify({ exitCode: 0, ok: true }))).toEqual({
      kind: 'done',
      result: { ok: true, exitCode: 0 },
    });
  });
});
