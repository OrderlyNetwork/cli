import kleur from 'kleur';
import axios from 'axios';
import { OrderlyClient } from '../lib/api.js';
import { resolveAccountId } from '../lib/account-select.js';
import { getKey } from '../lib/keychain.js';
import { Network } from '../types.js';

const VALID_ALGO_TYPES = ['STOP', 'TP_SL', 'POSITIONAL_TP_SL', 'TRAILING_STOP', 'BRACKET'];
const VALID_SIDES = ['BUY', 'SELL'];

export async function placeAlgoOrder(
  symbol: string,
  side: string,
  algoType: string,
  quantity: string,
  triggerPrice: string | undefined,
  callbackRate: string | undefined,
  orderPrice: string | undefined,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const validSide = side.toUpperCase();
  if (!VALID_SIDES.includes(validSide)) {
    console.log(kleur.red(`Invalid side. Use ${VALID_SIDES.join(' or ')}.`));
    return;
  }

  const validAlgoType = algoType.toUpperCase();
  if (!VALID_ALGO_TYPES.includes(validAlgoType)) {
    console.log(kleur.red(`Invalid algo type. Use one of: ${VALID_ALGO_TYPES.join(', ')}`));
    return;
  }

  if (validAlgoType === 'TRAILING_STOP') {
    if (!callbackRate) {
      console.log(kleur.red('--callback-rate is required for TRAILING_STOP orders.'));
      return;
    }
  } else {
    if (!triggerPrice) {
      console.log(kleur.red(`--trigger-price is required for ${validAlgoType} orders.`));
      return;
    }
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
    type: string;
    algoType: string;
    side: string;
    quantity: string;
    triggerPrice?: string;
    price?: string;
    callbackRate?: string;
  } = {
    symbol: symbol.toUpperCase(),
    type: orderPrice ? 'LIMIT' : 'MARKET',
    algoType: validAlgoType,
    side: validSide,
    quantity,
  };

  if (triggerPrice) {
    orderPayload.triggerPrice = triggerPrice;
  }
  if (orderPrice) {
    orderPayload.price = orderPrice;
  }
  if (callbackRate) {
    orderPayload.callbackRate = callbackRate;
  }

  try {
    const result = await client.placeAlgoOrder(orderPayload);
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

export async function cancelAlgoOrder(
  orderId: string,
  symbol: string | undefined,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  let orderSymbol = symbol;
  if (!orderSymbol) {
    try {
      const orderRes = await client.findAlgoOrderById(orderId);
      if (!orderRes.success || !orderRes.data) {
        console.log(kleur.red(`Algo order ${orderId} not found.`));
        return;
      }
      orderSymbol = orderRes.data.symbol;
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
      return;
    }
  }

  try {
    const result = await client.cancelAlgoOrder(orderId, orderSymbol!);
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

export async function cancelAllAlgoOrders(
  symbol: string | undefined,
  algoType: string | undefined,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const result = await client.cancelAllAlgoOrders(symbol, algoType);
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

export async function listAlgoOrders(
  symbol: string | undefined,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const result = await client.getAlgoOrders(symbol);
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
