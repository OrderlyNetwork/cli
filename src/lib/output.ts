import kleur from 'kleur';
import axios from 'axios';

type OutputFormat = 'json' | 'csv';

interface ApiResponse {
  success?: boolean;
  data?: unknown;
  [key: string]: unknown;
}

export function isPrettyJson(): boolean {
  return process.argv.includes('--pretty');
}

function unwrapResponse(response: unknown): unknown {
  if (response !== null && typeof response === 'object' && 'data' in response) {
    const api = response as ApiResponse;
    if (api.success === false) {
      return api;
    }
    return api.data;
  }
  return response;
}

function flattenObject(
  obj: Record<string, unknown>,
  prefix = '',
  schemaHints?: Map<string, string[]>
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      const childKeys = schemaHints?.get(newKey);
      if (childKeys && childKeys.length > 0) {
        for (const ck of childKeys) {
          result[`${newKey}.${ck}`] = '';
        }
      } else {
        result[newKey] = '';
      }
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey, schemaHints));
    } else if (Array.isArray(value)) {
      result[newKey] = JSON.stringify(value);
    } else {
      result[newKey] = String(value);
    }
  }

  return result;
}

function extractRows(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;

  const record = data as Record<string, unknown>;

  const arrayKey = Object.keys(record).find((k) => Array.isArray(record[k]));
  if (arrayKey) return record[arrayKey];

  const nullArrayKey = Object.keys(record).find(
    (k) => record[k] === null && (k === 'rows' || k === 'list' || k === 'data')
  );
  if (nullArrayKey) return [];

  return data;
}

function collectObjectSchema(value: unknown, prefix = ''): Map<string, string[]> {
  const schema = new Map<string, string[]>();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return schema;
  const obj = value as Record<string, unknown>;
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      const childKeys = Object.keys(val as Record<string, unknown>);
      schema.set(fullKey, childKeys);
      const nested = collectObjectSchema(val, fullKey);
      for (const [nk, nv] of nested) {
        const existing = schema.get(nk);
        if (existing) {
          const merged = [...new Set([...existing, ...nv])];
          schema.set(nk, merged);
        } else {
          schema.set(nk, nv);
        }
      }
    }
  }
  return schema;
}

function toCSV(data: unknown): string {
  const rows = extractRows(data);

  if (Array.isArray(rows)) {
    if (rows.length === 0) {
      return '';
    }

    const schemaHints = new Map<string, string[]>();
    for (const item of rows) {
      if (typeof item === 'object' && item !== null) {
        const itemSchema = collectObjectSchema(item);
        for (const [key, childKeys] of itemSchema) {
          const existing = schemaHints.get(key);
          if (existing) {
            schemaHints.set(key, [...new Set([...existing, ...childKeys])]);
          } else {
            schemaHints.set(key, childKeys);
          }
        }
      }
    }

    const allKeys = new Set<string>();
    const flatRows: Record<string, string>[] = [];
    for (const item of rows) {
      if (typeof item === 'object' && item !== null) {
        const flat = flattenObject(item as Record<string, unknown>, '', schemaHints);
        Object.keys(flat).forEach((k) => allKeys.add(k));
        flatRows.push(flat);
      }
    }

    const keys = Array.from(allKeys);
    const lines: string[] = [keys.join(',')];

    for (const flat of flatRows) {
      const values = keys.map((k) => escapeCsvValue(flat[k] ?? ''));
      lines.push(values.join(','));
    }

    return lines.join('\n');
  }

  if (typeof rows === 'object' && rows !== null) {
    const flat = flattenObject(rows as Record<string, unknown>);
    const keys = Object.keys(flat);
    return `${keys.join(',')}\n${keys.map((k) => escapeCsvValue(flat[k])).join(',')}`;
  }

  return String(rows);
}

function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function output(data: unknown, format: OutputFormat = 'json'): void {
  const unwrapped = unwrapResponse(data);

  if (format === 'csv') {
    const csv = toCSV(unwrapped);
    if (csv !== '') {
      console.log(csv);
    }
  } else {
    console.log(JSON.stringify(unwrapped, null, isPrettyJson() ? 2 : 0));
  }
}

const SYMBOL_PATTERN = /^[A-Z0-9]+_[A-Z0-9]+(_[A-Z0-9]+)*$/;

export function normalizeSymbol(symbol: string): string {
  let s = symbol.trim().toUpperCase().replace(/\/|-/g, '_');

  if (!s.includes('_') && s.length >= 3) {
    error(
      `Invalid symbol: "${symbol}". Expected format: PERP_<BASE>_<QUOTE> (e.g. PERP_ETH_USDC).`,
      ['Run `orderly symbols` to see available symbols.']
    );
  }

  if (!s.startsWith('PERP_')) {
    s = `PERP_${s}`;
  }

  if (!SYMBOL_PATTERN.test(s.slice(5))) {
    error(
      `Invalid symbol: "${symbol}". Expected format: PERP_<BASE>_<QUOTE> (e.g. PERP_ETH_USDC).`,
      ['Run `orderly symbols` to see available symbols.']
    );
  }

  return s;
}

export function normalizeOptionalSymbol(symbol: string | undefined): string | undefined {
  if (!symbol) return undefined;
  return normalizeSymbol(symbol);
}

export function error(message: string, hints?: string[]): never {
  console.error(kleur.red(message));
  if (hints?.length) {
    for (const hint of hints) {
      console.error(kleur.dim(hint));
    }
  }
  process.exit(1);
}

export type { OutputFormat };

export function handleError(err: unknown): never {
  if (axios.isAxiosError(err) && err.response?.data) {
    const status = err.response.status;
    const rawData = err.response.data;
    if (status === 429) {
      error('Rate limited. Please wait before trying again.');
    }
    const data =
      typeof rawData === 'object' && rawData !== null
        ? (rawData as Record<string, unknown>)
        : undefined;
    const code = data?.code;
    const message =
      typeof rawData === 'string' && rawData.startsWith('<')
        ? `Request failed with status ${status}`
        : data?.message || JSON.stringify(rawData);
    const parts = [`API Error [${status}]`];
    if (code !== undefined) parts.push(`[${code}]`);
    parts.push(`: ${message}`);
    error(parts.join(' '));
  } else if (err instanceof Error) {
    error(err.message);
  } else {
    error(String(err));
  }
}
