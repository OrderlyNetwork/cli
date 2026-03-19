import { existsSync, readFileSync } from 'fs';
import { OrderlyClient } from '../lib/api.js';
import { resolveAccountId } from '../lib/account-select.js';
import { getKey } from '../lib/keychain.js';
import { output, error, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';

const VALID_ORDER_TYPES = ['LIMIT', 'MARKET', 'IOC', 'FOK', 'POST_ONLY', 'ASK', 'BID'];
const PRICE_REQUIRED_TYPES = ['LIMIT', 'IOC', 'FOK', 'POST_ONLY'];

export async function place(
  symbol: string,
  side: string,
  type: string,
  quantity: string,
  price: string | undefined,
  clientOrderId: string | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const validSide = side.toUpperCase();
  if (validSide !== 'BUY' && validSide !== 'SELL') {
    error('Invalid side. Use BUY or SELL.');
  }

  const validType = type.toUpperCase();
  if (!VALID_ORDER_TYPES.includes(validType)) {
    error(`Invalid order type. Use one of: ${VALID_ORDER_TYPES.join(', ')}`);
  }

  if (PRICE_REQUIRED_TYPES.includes(validType) && !price) {
    error(`Price is required for ${validType} orders.`);
  }

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  const orderPayload: {
    symbol: string;
    order_type: string;
    side: string;
    order_quantity: string;
    order_price?: string;
    client_order_id?: string;
  } = {
    symbol: symbol.toUpperCase(),
    order_type: validType,
    side: validSide,
    order_quantity: quantity,
  };

  if (price) {
    orderPayload.order_price = price;
  }

  if (clientOrderId) {
    orderPayload.client_order_id = clientOrderId;
  }

  try {
    const result = await client.placeOrder(orderPayload);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function cancel(
  orderId: string,
  symbol: string | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  let orderSymbol = symbol;
  if (!orderSymbol) {
    try {
      const orderRes = await client.getOrder(orderId);
      if (!orderRes.success || !orderRes.data) {
        error(`Order ${orderId} not found.`);
      }
      orderSymbol = orderRes.data.symbol;
    } catch (err) {
      handleError(err);
    }
  }

  try {
    const result = await client.cancelOrder(orderId, orderSymbol);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function edit(
  orderId: string,
  symbol: string | undefined,
  price: string | undefined,
  quantity: string | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  if (!price && !quantity) {
    error('At least one of --price or --quantity is required to edit an order.', [
      'Examples:',
      '  orderly order-edit 123456 --price 3500',
      '  orderly order-edit 123456 --quantity 0.02',
      '  orderly order-edit 123456 --price 3500 --quantity 0.02',
    ]);
  }

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  let orderSymbol = symbol;
  let orderType: string | undefined;
  let orderSide: string | undefined;
  let existingPrice: string | undefined;
  let existingQuantity: string | undefined;

  try {
    const orderRes = await client.getOrder(orderId);
    if (!orderRes.success || !orderRes.data) {
      error(`Order ${orderId} not found.`);
    }
    if (!orderSymbol) {
      orderSymbol = orderRes.data.symbol;
    }
    orderType = orderRes.data.type;
    orderSide = orderRes.data.side;
    if (orderRes.data.price !== undefined && orderRes.data.price !== null) {
      existingPrice = String(orderRes.data.price);
    }
    if (orderRes.data.quantity !== undefined && orderRes.data.quantity !== null) {
      existingQuantity = String(orderRes.data.quantity);
    }
  } catch (err) {
    handleError(err);
  }

  const updates = {
    order_type: orderType!,
    side: orderSide!,
    order_price: Number(price ?? existingPrice),
    order_quantity: Number(quantity ?? existingQuantity),
  };

  try {
    const result = await client.editOrder(orderId, updates, orderSymbol!);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function cancelAll(
  symbol: string | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const result = await client.cancelAllOrders(symbol);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function listOrders(
  symbol: string | undefined,
  status: string | undefined,
  page: number | undefined,
  size: number | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const result = await client.getOrders(symbol, status?.toUpperCase(), page, size);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function batchPlace(
  ordersInput: string,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  let orders: Array<{
    symbol: string;
    order_type: string;
    side: string;
    order_quantity: string;
    order_price?: string;
    client_order_id?: string;
  }>;

  try {
    if (existsSync(ordersInput)) {
      const content = readFileSync(ordersInput, 'utf-8');
      orders = JSON.parse(content);
    } else {
      orders = JSON.parse(ordersInput);
    }
  } catch {
    error('Invalid JSON. Provide a valid JSON array or a path to a JSON file.');
  }

  if (!Array.isArray(orders) || orders.length === 0) {
    error('Orders must be a non-empty array.');
  }

  if (orders.length > 10) {
    error('Maximum 10 orders allowed per batch.');
  }

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const idx = `[${i}]`;

    if (typeof order !== 'object' || order === null) {
      error(`Order ${idx} must be an object.`);
    }

    if (!order.symbol || typeof order.symbol !== 'string') {
      error(`Order ${idx}: "symbol" is required (string).`);
    }

    if (!order.order_type || typeof order.order_type !== 'string') {
      error(`Order ${idx}: "order_type" is required (string).`);
    }

    const upperType = order.order_type.toUpperCase();
    if (!VALID_ORDER_TYPES.includes(upperType)) {
      error(
        `Order ${idx}: invalid "order_type" "${order.order_type}". Use one of: ${VALID_ORDER_TYPES.join(', ')}.`
      );
    }

    if (!order.side || typeof order.side !== 'string') {
      error(`Order ${idx}: "side" is required (BUY or SELL).`);
    }

    if (order.side.toUpperCase() !== 'BUY' && order.side.toUpperCase() !== 'SELL') {
      error(`Order ${idx}: invalid "side" "${order.side}". Use BUY or SELL.`);
    }

    if (!order.order_quantity || typeof order.order_quantity !== 'string') {
      error(`Order ${idx}: "order_quantity" is required (string, e.g. "0.01").`);
    }

    if (isNaN(Number(order.order_quantity)) || Number(order.order_quantity) <= 0) {
      error(`Order ${idx}: "order_quantity" must be a positive number.`);
    }

    if (PRICE_REQUIRED_TYPES.includes(upperType)) {
      if (order.order_price === undefined || order.order_price === null) {
        error(`Order ${idx}: "order_price" is required for ${upperType} orders.`);
      }
      if (isNaN(Number(order.order_price)) || Number(order.order_price) <= 0) {
        error(`Order ${idx}: "order_price" must be a positive number.`);
      }
    }
  }

  const normalizedOrders = orders.map((order) => ({
    symbol: order.symbol.toUpperCase(),
    order_type: order.order_type.toUpperCase(),
    side: order.side.toUpperCase(),
    order_quantity: order.order_quantity,
    ...(order.order_price !== undefined && order.order_price !== null
      ? { order_price: order.order_price }
      : {}),
    ...(order.client_order_id !== undefined ? { client_order_id: order.client_order_id } : {}),
  }));

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const result = await client.placeBatchOrder(normalizedOrders);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function batchCancel(
  orderIds: string[],
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const accId = await resolveAccountId(accountId, network);
  if (!accId) return;

  if (orderIds.length === 0) {
    error('At least one order ID is required.');
  }

  const keyPair = await getKey(accId, network);
  if (!keyPair) {
    error(`No key found for account ${accId} on ${network}`);
  }

  const client = new OrderlyClient(network);
  client.setKeyPair(keyPair);

  try {
    const result = await client.cancelBatchOrders(orderIds);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
