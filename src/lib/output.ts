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
    return (response as ApiResponse).data;
  }
  return response;
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      result[newKey] = '';
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey));
    } else if (Array.isArray(value)) {
      result[newKey] = JSON.stringify(value);
    } else {
      result[newKey] = String(value);
    }
  }

  return result;
}

function toCSV(data: unknown): string {
  if (
    typeof data === 'object' &&
    data !== null &&
    'rows' in data &&
    Array.isArray((data as Record<string, unknown>).rows)
  ) {
    const record = data as Record<string, unknown>;
    const rows = record.rows as Record<string, unknown>[];
    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'rows') {
        metadata[key] = value;
      }
    }
    if (Object.keys(metadata).length > 0) {
      data = rows.map((row) => ({ ...metadata, ...row }));
    } else {
      data = rows;
    }
  }

  if (!Array.isArray(data)) {
    if (typeof data === 'object' && data !== null) {
      const flat = flattenObject(data as Record<string, unknown>);
      const keys = Object.keys(flat);
      return `${keys.join(',')}\n${keys.map((k) => escapeCsvValue(flat[k])).join(',')}`;
    }
    return String(data);
  }

  if (data.length === 0) {
    return '';
  }

  const firstRow = data[0];
  if (typeof firstRow !== 'object' || firstRow === null) {
    return data.map((item) => String(item)).join('\n');
  }

  const allKeys = new Set<string>();
  for (const item of data) {
    if (typeof item === 'object' && item !== null) {
      const flat = flattenObject(item as Record<string, unknown>);
      Object.keys(flat).forEach((k) => allKeys.add(k));
    }
  }

  const keys = Array.from(allKeys);
  const lines: string[] = [keys.join(',')];

  for (const item of data) {
    if (typeof item === 'object' && item !== null) {
      const flat = flattenObject(item as Record<string, unknown>);
      const values = keys.map((k) => escapeCsvValue(flat[k] ?? ''));
      lines.push(values.join(','));
    }
  }

  return lines.join('\n');
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
    console.log(toCSV(unwrapped));
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
    const data = err.response.data as Record<string, unknown>;
    const status = err.response.status;
    const code = data?.code;
    const message = data?.message || JSON.stringify(data);
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
