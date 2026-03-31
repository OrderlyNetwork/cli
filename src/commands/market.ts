import axios from 'axios';
import { OrderlyClient } from '../lib/api.js';
import { fetchWsSnapshot } from '../lib/ws.js';
import { output, error, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';
import { getApiBaseUrl } from '../lib/config.js';

const VALID_KLINE_TYPES = ['1m', '5m', '15m', '30m', '1h', '4h', '12h', '1d', '1w', '1mon'];

const KLINE_TO_TV: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '4h': '240',
  '12h': '720',
  '1d': '1D',
  '1w': '1W',
  '1mon': '1M',
};

const TV_RESOLUTION_SECONDS: Record<string, number> = {
  '1': 60,
  '3': 180,
  '5': 300,
  '15': 900,
  '30': 1800,
  '60': 3600,
  '240': 14400,
  '720': 43200,
  '1D': 86400,
  '3D': 259200,
  '5D': 432000,
  '1W': 604800,
  '1M': 2592000,
};

interface TvHistoryResponse {
  s: string;
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  a?: number[];
}

export async function getPrice(
  symbol: string,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = await client.getMarketPrice(symbol.toUpperCase());
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function getKline(
  symbol: string,
  type: string,
  limit: number | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const validType = type.toLowerCase();
  if (!VALID_KLINE_TYPES.includes(validType)) {
    error(`Invalid kline type. Use one of: ${VALID_KLINE_TYPES.join(', ')}`);
  }

  const tvResolution = KLINE_TO_TV[validType];
  if (!tvResolution) {
    error(`Kline type '${validType}' is not supported via public API.`);
  }

  const resolutionSeconds = TV_RESOLUTION_SECONDS[tvResolution];
  const count = limit ?? 100;
  const to = Math.floor(Date.now() / 1000);
  const from = to - count * resolutionSeconds;

  try {
    const baseUrl = getApiBaseUrl(network);

    const { data } = await axios.get<TvHistoryResponse>(`${baseUrl}/v1/tv/history`, {
      params: {
        symbol: symbol.toUpperCase(),
        resolution: tvResolution,
        from,
        to,
      },
    });

    if (data.s !== 'ok' || !data.t?.length) {
      output({ rows: [] }, format);
      return;
    }

    const rows = data.t.map((startTs, i) => ({
      open: Number(data.o[i]),
      high: Number(data.h[i]),
      low: Number(data.l[i]),
      close: Number(data.c[i]),
      volume: Number(data.v[i]),
      amount: data.a ? Number(data.a[i]) : 0,
      symbol: symbol.toUpperCase(),
      type: validType,
      start_timestamp: startTs * 1000,
      end_timestamp: (startTs + resolutionSeconds) * 1000,
    }));

    output({ rows }, format);
  } catch (err) {
    handleError(err);
  }
}

interface WsOrderbookData {
  asks: [string, string][];
  bids: [string, string][];
}

export async function getOrderbook(
  symbol: string,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  try {
    const result = await fetchWsSnapshot<WsOrderbookData>(
      symbol.toUpperCase(),
      'orderbook',
      network
    );

    if (!result.success || !result.data) {
      error(result.error || 'Failed to fetch orderbook');
    }

    const asks = (result.data.asks ?? []).map(([price, quantity]) => ({
      price: Number(price),
      quantity: Number(quantity),
    }));

    const bids = (result.data.bids ?? []).map(([price, quantity]) => ({
      price: Number(price),
      quantity: Number(quantity),
    }));

    if (format === 'csv') {
      const rows = [
        ...asks.map((a) => ({ side: 'ask', ...a })),
        ...bids.map((b) => ({ side: 'bid', ...b })),
      ];
      output({ rows }, format);
    } else {
      output({ asks, bids }, format);
    }
  } catch (err) {
    handleError(err);
  }
}

export async function getSymbols(
  showInfo: boolean,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = showInfo ? await client.getSymbols() : await client.getFutures();
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function getMarketTrades(
  symbol: string,
  limit: number | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = await client.getMarketTrades(symbol.toUpperCase(), limit);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function getFundingRates(
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = await client.getFundingRates();
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function getPriceChanges(
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = await client.getPriceChanges();
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function getOpenInterest(
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = await client.getOpenInterest();
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function getLiquidatedPositions(
  symbol: string | undefined,
  page: number | undefined,
  size: number | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = await client.getLiquidatedPositions(symbol, page, size);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function getSystemStatus(
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  try {
    const client = new OrderlyClient(network);
    const result = await client.getSystemInfo();
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
