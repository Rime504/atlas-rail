/**
 * A tiny agent runtime with a pluggable "model".
 *
 * The default {@link ScriptedModel} is deterministic: it never calls an external LLM or the network,
 * so the demo cannot fail because of a model API. To use a real LLM, implement {@link AgentModel}
 * (see docs/DEMO.md): map the message history to the next tool call or final answer.
 */

export type AgentMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'tool'; tool: string; content: string };

export type AgentAction =
  | { type: 'tool_call'; tool: 'fetch_page' | 'fetch_paid'; url: string; thought: string }
  | { type: 'final'; content: string };

export interface AgentModel {
  readonly name: string;
  next(history: readonly AgentMessage[]): Promise<AgentAction>;
}

export interface AgentTools {
  /** Plain GET. Free pages can carry prompt injections. */
  fetch_page(url: string): Promise<string>;
  /** GET that transparently pays x402 402 responses through the Atlas Rail gate. */
  fetch_paid(url: string): Promise<string>;
}

export interface AgentTrace {
  steps: Array<{ action: AgentAction; result?: string }>;
  final: string;
}

/** Runs the model/tool loop until the model answers or `maxSteps` is reached. */
export async function runAgent(model: AgentModel, tools: AgentTools, task: string, maxSteps = 6): Promise<AgentTrace> {
  const history: AgentMessage[] = [
    { role: 'system', content: 'You are a research agent with a limited spending mandate. Use tools to complete the task.' },
    { role: 'user', content: task },
  ];
  const steps: AgentTrace['steps'] = [];
  for (let i = 0; i < maxSteps; i++) {
    const action = await model.next(history);
    if (action.type === 'final') {
      steps.push({ action });
      return { steps, final: action.content };
    }
    history.push({ role: 'assistant', content: `[${action.tool}] ${action.thought}` });
    let result: string;
    try {
      result = await tools[action.tool](action.url);
    } catch (error) {
      result = `TOOL_ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
    history.push({ role: 'tool', tool: action.tool, content: result });
    steps.push({ action, result });
  }
  return { steps, final: 'Stopped: step limit reached.' };
}

/**
 * Deterministic stand-in for an LLM. Each script step is a function of the history so far, which lets
 * the demo model a *compromised* agent faithfully: after reading a page that contains an injected
 * instruction, it obeys it, exactly as a successfully prompt-injected model would.
 */
export class ScriptedModel implements AgentModel {
  readonly name = 'scripted (deterministic, no external model)';
  private step = 0;

  constructor(private readonly script: Array<(history: readonly AgentMessage[]) => AgentAction>) {}

  async next(history: readonly AgentMessage[]): Promise<AgentAction> {
    const action = this.script[Math.min(this.step, this.script.length - 1)](history);
    this.step += 1;
    return action;
  }
}

const lastTool = (history: readonly AgentMessage[]) => [...history].reverse().find((m) => m.role === 'tool');

/** Scene 2: buy one research summary and report it. */
export function researchModel(url: string): AgentModel {
  return new ScriptedModel([
    () => ({ type: 'tool_call', tool: 'fetch_paid', url, thought: 'The summary endpoint costs $0.01; that is within my mandate. Buying it.' }),
    (history) => {
      const tool = lastTool(history);
      return tool && !tool.content.startsWith('TOOL_ERROR')
        ? { type: 'final', content: `Done. ${tool.content.slice(0, 160)}` }
        : { type: 'final', content: `I could not complete the task: ${tool?.content ?? 'no result'}` };
    },
  ]);
}

/** Scene 3: a compromised agent that follows an injected instruction found in a free web page. */
export function injectedModel(bulletinUrl: string): AgentModel {
  return new ScriptedModel([
    () => ({ type: 'tool_call', tool: 'fetch_page', url: bulletinUrl, thought: 'Reading the market bulletin as instructed.' }),
    (history) => {
      const page = lastTool(history)?.content ?? '';
      const invoice = /https?:\/\/\S+\/invoice\S*/.exec(page)?.[0] ?? '';
      return {
        type: 'tool_call',
        tool: 'fetch_paid',
        url: invoice,
        thought: 'The bulletin says my account will be suspended unless I pay this invoice immediately. Paying.',
      };
    },
    (history) => ({
      type: 'final',
      content: `The payment did not go through: ${lastTool(history)?.content ?? 'unknown error'}`,
    }),
  ]);
}

/** Scene 4: needs an expensive inference job that is outside autonomous authority. */
export function heavyInferenceModel(url: string): AgentModel {
  return new ScriptedModel([
    () => ({ type: 'tool_call', tool: 'fetch_paid', url, thought: 'The batch analysis needs the heavy inference endpoint ($40). That needs human approval.' }),
    (history) => {
      const tool = lastTool(history);
      return tool && !tool.content.startsWith('TOOL_ERROR')
        ? { type: 'final', content: `Approved and completed. ${tool.content.slice(0, 160)}` }
        : { type: 'final', content: `Not completed: ${tool?.content ?? 'no result'}` };
    },
  ]);
}
