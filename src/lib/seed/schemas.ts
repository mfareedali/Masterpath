/**
 * JSON Schema (draft 2020-12) validation for the seed files and for single proposed values.
 * The schemas live in data/schemas/ (the seed files point at them with "$schema", so editors validate as you type).
 * Used by scripts only (validator, ingestion); never imported by the app.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import programsSchema from '@data/schemas/programs.schema.json';
import countryFactsSchema from '@data/schemas/country_facts.schema.json';
import conversionRulesSchema from '@data/schemas/conversion_rules.schema.json';
import fxRatesSchema from '@data/schemas/fx_rates.schema.json';
import type { ValueKind } from './fields';

export type SeedFileName =
  | 'programs.seed.json'
  | 'country_facts.seed.json'
  | 'conversion_rules.seed.json'
  | 'fx_rates.seed.json';

export const SEED_SCHEMAS: Record<SeedFileName, Record<string, unknown>> = {
  'programs.seed.json': programsSchema,
  'country_facts.seed.json': countryFactsSchema,
  'conversion_rules.seed.json': conversionRulesSchema,
  'fx_rates.seed.json': fxRatesSchema,
};

export interface SchemaIssue {
  /** JSON pointer into the data, e.g. "/programs/3/deadline/value". */
  path: string;
  message: string;
}

function makeAjv(): Ajv2020 {
  // strictRequired is off because `factBase` requires "value" while each concrete fact_* schema defines it.
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
  addFormats(ajv);
  return ajv;
}

let ajvSingleton: Ajv2020 | null = null;
const fileValidators = new Map<SeedFileName, ValidateFunction>();
const valueValidators = new Map<ValueKind, ValidateFunction>();

function ajv(): Ajv2020 {
  ajvSingleton ??= makeAjv();
  return ajvSingleton;
}

function fileValidator(file: SeedFileName): ValidateFunction {
  let v = fileValidators.get(file);
  if (!v) {
    v = ajv().compile(SEED_SCHEMAS[file]);
    fileValidators.set(file, v);
  }
  return v;
}

/** Ajv errors → short, de-duplicated messages. Drops the generic "must match a schema in anyOf/if" wrappers. */
export function formatAjvErrors(errors: ErrorObject[] | null | undefined): SchemaIssue[] {
  if (!errors) return [];
  const seen = new Set<string>();
  const out: SchemaIssue[] = [];
  for (const e of errors) {
    if (e.keyword === 'anyOf' || e.keyword === 'if' || e.keyword === 'oneOf') continue;
    let message = e.message ?? 'is invalid';
    if (e.keyword === 'additionalProperties' || e.keyword === 'unevaluatedProperties') {
      const extra = (e.params as { additionalProperty?: string; unevaluatedProperty?: string }).additionalProperty ??
        (e.params as { unevaluatedProperty?: string }).unevaluatedProperty;
      message = `has an unknown key "${extra}"`;
    } else if (e.keyword === 'enum') {
      const allowed = (e.params as { allowedValues?: unknown[] }).allowedValues ?? [];
      message = `must be one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}`;
    } else if (e.keyword === 'required') {
      message = `is missing the key "${(e.params as { missingProperty: string }).missingProperty}"`;
    }
    const key = `${e.instancePath}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: e.instancePath || '/', message });
  }
  return out;
}

/** Validates a whole seed file against its JSON Schema. */
export function validateSeedFileSchema(file: SeedFileName, data: unknown): SchemaIssue[] {
  const v = fileValidator(file);
  return v(data) ? [] : formatAjvErrors(v.errors);
}

/**
 * Validates ONE value against `$defs/value_<kind>` of programs.schema.json (used to check proposed values).
 * Null is rejected here: a proposal must carry a value.
 */
export function validateFieldValue(kind: ValueKind, value: unknown): SchemaIssue[] {
  if (value === null || value === undefined) return [{ path: '/', message: 'value is missing' }];
  let v = valueValidators.get(kind);
  if (!v) {
    const defs = (programsSchema as { $defs: Record<string, unknown> }).$defs;
    if (!defs[`value_${kind}`]) throw new Error(`No schema definition value_${kind}`);
    v = ajv().compile({ $defs: defs, $ref: `#/$defs/value_${kind}` });
    valueValidators.set(kind, v);
  }
  return v(value) ? [] : formatAjvErrors(v.errors);
}

const adHocValidators = new Map<object, ValidateFunction>();

/** Validates any data against a standalone JSON Schema from data/schemas (compiled once per schema object). */
export function validateAgainst(schema: object, data: unknown): SchemaIssue[] {
  let v = adHocValidators.get(schema);
  if (!v) {
    v = ajv().compile(schema);
    adHocValidators.set(schema, v);
  }
  return v(data) ? [] : formatAjvErrors(v.errors);
}
