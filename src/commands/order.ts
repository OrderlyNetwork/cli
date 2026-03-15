import kleur from 'kleur';
import axios from 'axios';
import { existsSync, readFileSync } from 'fs';
import { OrderlyClient } from '../lib/api.js';
import { resolveAccountId } from '../lib/account-select.js';
import { getKey } from '../lib/keychain.js';
import { Network } from '../types.js';

const VALID_ORDER_TYPES = ['LIMIT', 'MARKET', 'IOC', 'FOK', 'POST_ONLY', 'ASK', 'BID'];
const PRICE_REQUIRED_TYPES = ['LIMIT', 'IOC', 'FOK', 'POST_ONLY'];

export async function place(
  symbol: string,
  side: string,
  type: string,
  quantity: string,
  price: string | undefined,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const validSide = side.toUpperCase();
  if (validSide !== 'BUY' && validSide !== 'SELL') {
    console.log(kleur.red('Invalid side. Use BUY or SELL.'));
    return;
  }

  const validType = type.toUpperCase();
  if (!VALID_ORDER_TYPES.includes(validType)) {
    console.log(kleur.red(`Invalid order type. Use one of: ${VALID_ORDER_TYPES.join(', ')}`));
    return;
  }

  if (PRICE_REQUIRED_TYPES.includes(validType) && !price) {
    console.log(kleur.red(`Price is required for ${validType} orders.`));
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
      const orderRes = await client.getOrder(orderId);
      if (!orderRes.success || !orderRes.data) {
        console.log(kleur.red(`Order ${orderId} not found.`));
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
    const result = await client.cancelOrder(orderId, orderSymbol);
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

export async function edit(
  orderId: string,
  symbol: string | undefined,
  price: string | undefined,
  quantity: string | undefined,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  if (!price && !quantity) {
    console.log(kleur.red('At least one of --price or --quantity is required to edit an order.'));
    console.log(
      kleur.dim(
        'Examples:\n  orderly order-edit 123456 --price 3500\n  orderly order-edit 123456 --quantity 0.02\n  orderly order-edit 123456 --price 3500 --quantity 0.02'
      )
    );
    return;
  }

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    console.log(kleur.red(`No key found for account ${accId} on ${network}`));
    return;
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  let orderSymbol = symbol;
  let orderType: string | undefined;
  let orderSide: string | undefined;
  let existingQuantity: string | undefined;
  let existingPrice: string | undefined;

  try {
    const orderRes = await client.getOrder(orderId);
    if (!orderRes.success || !orderRes.data) {
      console.log(kleur.red(`Order ${orderId} not found.`));
      return;
    }
    if (!orderSymbol) {
      orderSymbol = orderRes.data.symbol;
    }
    orderType = orderRes.data.type;
    orderSide = orderRes.data.side;
    if (!quantity && orderRes.data.quantity !== undefined) {
      existingQuantity = String(orderRes.data.quantity);
    }
    if (!price && orderRes.data.price !== undefined) {
      existingPrice = String(orderRes.data.price);
    }
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

  const updates: {
    order_price?: string;
    order_quantity?: string;
    order_type: string;
    side: string;
  } = {
    order_type: orderType!,
    side: orderSide!,
    order_price: price ?? existingPrice,
    order_quantity: quantity ?? existingQuantity,
  };

  try {
    const result = await client.editOrder(orderId, updates, orderSymbol!);
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

export async function cancelAll(
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
    const result = await client.cancelAllOrders(symbol);
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

export async function batchPlace(
  ordersInput: string,
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  let orders: Array<{
    symbol: string;
    order_type: string;
    side: string;
    order_quantity: string;
    order_price?: string;
  }>;

  if (existsSync(ordersInput)) {
    const content = readFileSync(ordersInput, 'utf-8');
    orders = JSON.parse(content);
  } else {
    orders = JSON.parse(ordersInput);
  }

  if (!Array.isArray(orders) || orders.length === 0) {
    console.log(kleur.red('Orders must be a non-empty array.'));
    return;
  }

  if (orders.length > 10) {
    console.log(kleur.red('Maximum 10 orders allowed per batch.'));
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
    const result = await client.placeBatchOrder(orders);
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

export async function batchCancel(
  orderIds: string[],
  accountId: string | undefined,
  network: Network
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  if (orderIds.length === 0) {
    console.log(kleur.red('At least one order ID is required.'));
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
    const result = await client.cancelBatchOrders(orderIds);
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
