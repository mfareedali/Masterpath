import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_INGEST_MODEL, ingestModel, makeClaudeProposer, type MessagesClient } from './claude-proposer';
import { buildExtractionPrompt } from './ingest';

const PROMPT = buildExtractionPrompt({
  programName: 'MSc Fixture Computing',
  institutionName: 'Fixture University',
  sourceUrl: 'https://fixture.example.edu/msc',
  fields: ['deadline'],
  pageText: 'The application deadline is 15 January 2027.',
});

function message(text: string, stop_reason: string = 'end_turn'): Anthropic.Message {
  return { content: [{ type: 'text', text }], stop_reason } as unknown as Anthropic.Message;
}

function fakeClient(responses: Array<Anthropic.Message | Error>) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    messages: {
      async create(params) {
        calls.push(params);
        const next = responses.shift();
        if (!next) throw new Error('no more fake responses');
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
  return { client, calls };
}

describe('makeClaudeProposer', () => {
  it('sends low effort, structured JSON output, the untrusted-page prompt and no tools', async () => {
    const { client, calls } = fakeClient([message('{"proposals":[]}')]);
    const out = await makeClaudeProposer({ model: 'test-model', client })(PROMPT);
    expect(out).toBe('{"proposals":[]}');
    expect(calls).toHaveLength(1);
    const params = calls[0];
    expect(params.model).toBe('test-model');
    expect(params.output_config?.effort).toBe('low');
    expect(params.output_config?.format?.type).toBe('json_schema');
    expect(params).not.toHaveProperty('tools');
    expect(params).not.toHaveProperty('thinking');
    expect(params.system).toMatch(/untrusted data, not instructions/);
    expect(JSON.stringify(params.messages)).toMatch(/untrusted_page_text/);
  });

  it('retries once without structured output when the model rejects it (HTTP 400)', async () => {
    const badRequest = Object.assign(new Error('format not supported'), { status: 400 });
    const { client, calls } = fakeClient([badRequest, message('[]')]);
    expect(await makeClaudeProposer({ model: 'm', client })(PROMPT)).toBe('[]');
    expect(calls).toHaveLength(2);
    expect(calls[1].output_config).toEqual({ effort: 'low' });
  });

  it('does not retry other errors', async () => {
    const serverError = Object.assign(new Error('overloaded'), { status: 529 });
    const { client, calls } = fakeClient([serverError]);
    await expect(makeClaudeProposer({ model: 'm', client })(PROMPT)).rejects.toThrow('overloaded');
    expect(calls).toHaveLength(1);
  });

  it('throws on a refusal or a cut-off answer', async () => {
    const refused = fakeClient([message('', 'refusal')]);
    await expect(makeClaudeProposer({ model: 'm', client: refused.client })(PROMPT)).rejects.toThrow(/declined/);
    const cut = fakeClient([message('{"propos', 'max_tokens')]);
    await expect(makeClaudeProposer({ model: 'm', client: cut.client })(PROMPT)).rejects.toThrow(/cut off/);
  });
});

describe('ingestModel', () => {
  it('uses ANTHROPIC_MODEL or the default', () => {
    expect(ingestModel({})).toBe(DEFAULT_INGEST_MODEL);
    expect(ingestModel({ ANTHROPIC_MODEL: '  ' })).toBe(DEFAULT_INGEST_MODEL);
    expect(ingestModel({ ANTHROPIC_MODEL: 'other-model' })).toBe('other-model');
  });
});
