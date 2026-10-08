import { describe, expect, it, vi } from 'vitest';
import { AgentMessage } from './model';
import { LlmModel, resolveLlmModel } from './llm-model';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const history: readonly AgentMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'Summarise the latest research.' },
];

describe('resolveLlmModel', () => {
  it('throws for openai without a model id (never guesses one)', () => {
    expect(() => resolveLlmModel({ provider: 'openai', apiKey: 'k' })).toThrow(/AGENT_MODEL/);
  });

  it('defaults a current model for anthropic', () => {
    const model = resolveLlmModel({ provider: 'anthropic', apiKey: 'k' });
    expect(model.name).toContain('anthropic:claude-haiku-4-5-20251001');
  });

  it('accepts an explicit model override for either provider', () => {
    expect(resolveLlmModel({ provider: 'openai', apiKey: 'k', model: 'gpt-x' }).name).toContain('openai:gpt-x');
    expect(resolveLlmModel({ provider: 'anthropic', apiKey: 'k', model: 'claude-x' }).name).toContain('anthropic:claude-x');
  });
});

describe('LlmModel — anthropic', () => {
  it('maps a tool_use response to a tool_call action', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [
          { type: 'text', text: 'The research endpoint looks right for this.' },
          { type: 'tool_use', id: 'call_1', name: 'fetch_paid_resource', input: { url: 'https://example.com/research' } },
        ],
      }),
    );
    const model = new LlmModel({ provider: 'anthropic', apiKey: 'k', model: 'claude-x', fetchImpl });
    const action = await model.next(history);
    expect(action).toEqual({
      type: 'tool_call',
      tool: 'fetch_paid_resource',
      url: 'https://example.com/research',
      thought: 'The research endpoint looks right for this.',
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('claude-x');
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual(['fetch_page', 'fetch_paid_resource']);
  });

  it('threads the tool result back as a tool_result block on the next call', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ content: [{ type: 'tool_use', id: 'call_1', name: 'fetch_paid_resource', input: { url: 'https://x' } }] }))
      .mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'Done.' }] }));
    const model = new LlmModel({ provider: 'anthropic', apiKey: 'k', model: 'claude-x', fetchImpl });
    await model.next(history);
    const withResult: readonly AgentMessage[] = [...history, { role: 'assistant', content: '[fetch_paid_resource] ...' }, { role: 'tool', tool: 'fetch_paid_resource', content: 'HTTP 200 ok' }];
    const final = await model.next(withResult);
    expect(final).toEqual({ type: 'final', content: 'Done.' });
    const secondBody = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string);
    const lastMessage = secondBody.messages[secondBody.messages.length - 1];
    expect(lastMessage).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'HTTP 200 ok' }] });
  });

  it('returns a final action when there is no tool_use block', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'All done, nothing to buy.' }] }));
    const model = new LlmModel({ provider: 'anthropic', apiKey: 'k', model: 'claude-x', fetchImpl });
    expect(await model.next(history)).toEqual({ type: 'final', content: 'All done, nothing to buy.' });
  });

  it('throws a clear error on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad key' }, false, 401));
    const model = new LlmModel({ provider: 'anthropic', apiKey: 'bad', model: 'claude-x', fetchImpl });
    await expect(model.next(history)).rejects.toThrow(/Anthropic API error 401/);
  });
});

describe('LlmModel — openai', () => {
  it('maps a tool_calls response to a tool_call action', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: 'Reading the bulletin.',
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'fetch_page', arguments: JSON.stringify({ url: 'https://bulletin' }) } }],
            },
          },
        ],
      }),
    );
    const model = new LlmModel({ provider: 'openai', apiKey: 'k', model: 'gpt-x', fetchImpl });
    const action = await model.next(history);
    expect(action).toEqual({ type: 'tool_call', tool: 'fetch_page', url: 'https://bulletin', thought: 'Reading the bulletin.' });
  });

  it('tolerates malformed tool-call arguments instead of throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'fetch_page', arguments: '{not json' } }] } }] }),
    );
    const model = new LlmModel({ provider: 'openai', apiKey: 'k', model: 'gpt-x', fetchImpl });
    const action = await model.next(history);
    expect(action).toMatchObject({ type: 'tool_call', tool: 'fetch_page', url: '' });
  });

  it('returns a final action when there are no tool calls', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'Finished.' } }] }));
    const model = new LlmModel({ provider: 'openai', apiKey: 'k', model: 'gpt-x', fetchImpl });
    expect(await model.next(history)).toEqual({ type: 'final', content: 'Finished.' });
  });

  it('throws a clear error on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'rate limited' }, false, 429));
    const model = new LlmModel({ provider: 'openai', apiKey: 'k', model: 'gpt-x', fetchImpl });
    await expect(model.next(history)).rejects.toThrow(/OpenAI API error 429/);
  });
});
