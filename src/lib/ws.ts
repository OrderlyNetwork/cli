import { getWsBaseUrl } from './config.js';
import { Network } from '../types.js';

interface WsSnapshotResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function fetchWsSnapshot<T>(
  symbol: string,
  topic: string,
  network: Network,
  timeout = 10000
): Promise<WsSnapshotResult<T>> {
  const url = getWsBaseUrl(network);

  return new Promise((resolve) => {
    let settled = false;

    const ws = new WebSocket(url);

    const done = (result: WsSnapshotResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({ success: false, error: `WebSocket timeout after ${timeout}ms` });
    }, timeout);

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 'cli_snapshot',
          event: 'subscribe',
          topic: `${symbol}@${topic}`,
        })
      );
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);

        if (msg.event === 'ping') {
          ws.send(JSON.stringify({ event: 'pong' }));
          return;
        }

        if (msg.event === 'subscribe') {
          if (msg.success === false) {
            done({ success: false, error: msg.errorMsg || 'Subscription failed' });
          }
          return;
        }

        if (msg.topic && msg.data !== undefined && msg.data !== null) {
          done({ success: true, data: msg.data as T });
        }
      } catch {
        // ignore parse errors for non-JSON messages
      }
    });

    ws.addEventListener('error', () => {
      done({ success: false, error: `Failed to connect to WebSocket at ${url}` });
    });

    ws.addEventListener('close', (event: CloseEvent) => {
      done({
        success: false,
        error: `WebSocket closed before receiving data (code: ${event.code})`,
      });
    });
  });
}
