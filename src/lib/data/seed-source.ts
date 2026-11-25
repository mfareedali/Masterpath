import programsSeed from '@data/programs.seed.json';
import countryFactsSeed from '@data/country_facts.seed.json';
import conversionRulesSeed from '@data/conversion_rules.seed.json';
import fxRatesSeed from '@data/fx_rates.seed.json';
import type { ConversionRule, CountryFact, FxRate, Institution, Program } from '../types';
import type { Dataset, DataSource } from './index';

/** Pure loader for the bundled seed JSON (also used by scripts and tests). */
export function loadSeedDataset(): Dataset {
  return {
    programs: programsSeed.programs as unknown as Program[],
    institutions: programsSeed.institutions as unknown as Institution[],
    countryFacts: countryFactsSeed.country_facts as unknown as CountryFact[],
    conversionRules: conversionRulesSeed.conversion_rules as unknown as ConversionRule[],
    fxRates: fxRatesSeed.fx_rates as unknown as FxRate[],
  };
}

export const seedSource: DataSource = {
  name: 'seed',
  async load() {
    return loadSeedDataset();
  },
};
