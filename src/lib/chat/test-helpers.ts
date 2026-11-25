/**
 * Test helpers for the chat (never import from app code). Fixture values are fictional ("Fixture University").
 */
import type { CountryFact, CountryFactKey, CountryFactValue, Fact } from '@/lib/types';
import { makeInstitution, makeProgram } from '@/lib/test-fixtures';
import type { ChatModelClient, ModelStreamEvent, ModelStreamRequest } from './answer';
import type { ChatDataset } from './retrieve';

/** A fake model client that records every request and streams the given chunks. */
export function mockModel(
  chunks: string[] = ['Fixture answer.'],
  end: { stopReason?: string | null; outputTokens?: number; throwAfter?: number } = {},
): ChatModelClient & { calls: ModelStreamRequest[] } {
  const calls: ModelStreamRequest[] = [];
  return {
    calls,
    async *stream(req: ModelStreamRequest): AsyncGenerator<ModelStreamEvent> {
      calls.push(req);
      let i = 0;
      for (const text of chunks) {
        if (end.throwAfter !== undefined && i >= end.throwAfter) throw new Error('fixture network failure');
        i++;
        yield { type: 'text', text };
      }
      if (end.throwAfter !== undefined && i >= end.throwAfter) throw new Error('fixture network failure');
      yield { type: 'end', stopReason: end.stopReason ?? 'end_turn', outputTokens: end.outputTokens ?? 42 };
    },
  };
}

export function countryFact(
  country: string,
  key: CountryFactKey,
  fact: Fact<CountryFactValue>,
  id = `${country.toLowerCase()}-${key}`,
): CountryFact {
  return { id, country, key, ...fact };
}

/** A one-university fixture dataset; override the program's facts per test. */
export function fixtureDataset(overrides: Parameters<typeof makeProgram>[0] = {}, countryFacts: CountryFact[] = []): ChatDataset {
  return {
    programs: [makeProgram(overrides)],
    institutions: [makeInstitution()],
    countryFacts,
  };
}
