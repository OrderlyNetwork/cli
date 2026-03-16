type OutputFormat = 'json' | 'csv';

interface ApiResponse {
  success?: boolean;
  data?: unknown;
  [key: string]: unknown;
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
    data = (data as Record<string, unknown>).rows;
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
    console.log(JSON.stringify(unwrapped));
  }
}

export type { OutputFormat };
