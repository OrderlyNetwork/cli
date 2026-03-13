import kleur from 'kleur';
import axios from 'axios';
import { OrderlyClient } from '../lib/api.js';
import { getKey } from '../lib/keychain.js';
import { getDefaultAccount } from '../lib/config.js';
import { Network } from '../types.js';

export async function place(
  symbol: string,
  side: string,
  type: string,
  quantity: string,
  price: string | undefined,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = accountId ?? getDefaultAccount();

  if (!accId) {
    console.log(kleur.red('No account specified and no default account set.'));
    console.log(kleur.dim('Use `orderly auth-init` first.'));
    return;
  }

  const validSide = side.toUpperCase();
  if (validSide !== 'BUY' && validSide !== 'SELL') {
    console.log(kleur.red('Invalid side. Use BUY or SELL.'));
    return;
  }

  const validType = type.toUpperCase();
  if (validType !== 'LIMIT' && validType !== 'MARKET') {
    console.log(kleur.red('Invalid order type. Use LIMIT or MARKET.'));
    return;
  }

  if (validType === 'LIMIT' && !price) {
    console.log(kleur.red('Price is required for LIMIT orders.'));
    return;
  }

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  const orderPayload: {
    symbol: string;
    order_type: string;
    side: string;
    order_quantity: string;
    order_price?: string;
  } = {
    symbol: symbol.toUpperCase(),
    order_type: validType,
    side: validSide,
    order_quantity: quantity,
  };

  if (price) {
    orderPayload.order_price = price;
  }

  try {
    const result = await client.placeOrder(orderPayload);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      console.error(
        kleur.red(
          `API Error: ${error.response.data.message || JSON.stringify(error.response.data)}`
        )
      );
    } else if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}

export async function cancel(
  orderId: string,
  symbol: string | undefined,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = accountId ?? getDefaultAccount();

  if (!accId) {
    console.log(kleur.red('No account specified and no default account set.'));
    console.log(kleur.dim('Use `orderly auth-init` first.'));
    return;
  }

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const result = await client.cancelOrder(orderId, symbol);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      console.error(
        kleur.red(
          `API Error: ${error.response.data.message || JSON.stringify(error.response.data)}`
        )
      );
    } else if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}

export async function listOrders(
  symbol: string | undefined,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = accountId ?? getDefaultAccount();

  if (!accId) {
    console.log(kleur.red('No account specified and no default account set.'));
    console.log(kleur.dim('Use `orderly auth-init` first.'));
    return;
  }

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const result = await client.getOrders(symbol);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      console.error(
        kleur.red(
          `API Error: ${error.response.data.message || JSON.stringify(error.response.data)}`
        )
      );
    } else if (error instanceof Error) {
      console.error(kleur.red(error.message));
    }
  }
}
