import { existsSync, readFileSync } from 'fs';
import { createAuthenticatedClient } from '../lib/account-select.js';
import { output, error, handleError, OutputFormat, normalizeSymbol } from '../lib/output.js';
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
  reduceOnly: boolean,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
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

  const numQty = Number(quantity);
  if (isNaN(numQty) || numQty <= 0) {
    error('Quantity must be a positive number.');
  }

  const { client } = await createAuthenticatedClient(accountId, network);

  const orderPayload: {
    symbol: string;
    order_type: string;
    side: string;
    order_quantity: string;
    order_price?: string;
    client_order_id?: string;
    reduce_only?: boolean;
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

  if (reduceOnly) {
    orderPayload.reduce_only = true;
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
  const { client } = await createAuthenticatedClient(accountId, network);

  let orderSymbol = symbol;
  if (!orderSymbol) {
    try {
      const orderRes = await client.getOrder(orderId);
      if (!orderRes.success || !orderRes.data) {
        error(`Order ${orderId} not found.`);
      }
      orderSymbol = orderRes.data.symbol as string;
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
  if (!price && !quantity) {
    error('At least one of --price or --quantity is required to edit an order.', [
      'Examples:',
      '  orderly order-edit 123456 --price 3500',
      '  orderly order-edit 123456 --quantity 0.02',
      '  orderly order-edit 123456 --price 3500 --quantity 0.02',
    ]);
  }

  const { client } = await createAuthenticatedClient(accountId, network);

  let orderSymbol = symbol;
  let orderType: string | undefined;
  let orderSide: string | undefined;
  let existingPrice: string | undefined;
  let existingQuantity: string | undefined;
  let existingVisibleQty: number | undefined;
  let existingClientOrderId: string | undefined;

  try {
    const orderRes = await client.getOrder(orderId);
    if (!orderRes.success || !orderRes.data) {
      error(`Order ${orderId} not found.`);
    }
    const d = orderRes.data;
    if (!orderSymbol) {
      orderSymbol = d.symbol as string;
    }
    orderType = d.type as string;
    orderSide = d.side as string;
    if (d.price !== undefined && d.price !== null) {
      existingPrice = String(d.price);
    }
    if (d.quantity !== undefined && d.quantity !== null) {
      existingQuantity = String(d.quantity);
    }
    if (d.visible_quantity !== undefined && d.visible_quantity !== null) {
      existingVisibleQty = d.visible_quantity as number;
    }
    if (d.client_order_id) {
      existingClientOrderId = d.client_order_id as string;
    }
  } catch (err) {
    handleError(err);
  }

  if (price !== undefined) {
    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice <= 0) {
      error('Price must be a positive number.');
    }
  }
  if (quantity !== undefined) {
    const numQty = Number(quantity);
    if (isNaN(numQty) || numQty <= 0) {
      error('Quantity must be a positive number.');
    }
  }

  const updates: Record<string, unknown> = {
    order_type: orderType!,
    side: orderSide!,
    order_price: price !== undefined ? Number(price) : Number(existingPrice),
    order_quantity: quantity !== undefined ? Number(quantity) : Number(existingQuantity),
  };
  if (existingVisibleQty !== undefined) {
    updates.visible_quantity = existingVisibleQty;
  }
  if (existingClientOrderId !== undefined) {
    updates.client_order_id = existingClientOrderId;
  }

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
  const { client } = await createAuthenticatedClient(accountId, network);

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
  side: string | undefined,
  orderType: string | undefined,
  sortBy: string | undefined,
  page: number | undefined,
  size: number | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await client.getOrders(
      symbol,
      status?.toUpperCase(),
      side?.toUpperCase(),
      orderType?.toUpperCase(),
      sortBy,
      page,
      size
    );
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

type RawBatchOrder = Record<string, unknown>;

interface NormalizedBatchOrder {
  symbol: string;
  order_type: string;
  side: string;
  order_quantity: string;
  order_price?: string;
  client_order_id?: string;
}

function normalizeBatchOrder(order: RawBatchOrder, index: number): NormalizedBatchOrder {
  const idx = `[${index}]`;

  if (typeof order !== 'object' || order === null) {
    error(`Order ${idx} must be an object.`);
  }

  const symbol = (order.symbol ?? order.s) as string | undefined;
  if (!symbol || typeof symbol !== 'string') {
    error(`Order ${idx}: "symbol" is required.`);
  }

  const rawType = (order.type ?? order.order_type ?? order.t) as string | undefined;
  if (!rawType || typeof rawType !== 'string') {
    error(`Order ${idx}: "type" is required.`);
  }
  const upperType = rawType.toUpperCase();
  if (!VALID_ORDER_TYPES.includes(upperType)) {
    error(`Order ${idx}: invalid type "${rawType}". Use one of: ${VALID_ORDER_TYPES.join(', ')}.`);
  }

  const side = (order.side ?? order.s) as string | undefined;
  if (!side || typeof side !== 'string') {
    error(`Order ${idx}: "side" is required (BUY or SELL).`);
  }
  if (side.toUpperCase() !== 'BUY' && side.toUpperCase() !== 'SELL') {
    error(`Order ${idx}: invalid side "${side}". Use BUY or SELL.`);
  }

  const rawQty = (order.quantity ?? order.order_quantity ?? order.qty ?? order.q) as
    | string
    | number
    | undefined;
  if (rawQty === undefined || rawQty === null) {
    error(`Order ${idx}: "quantity" is required.`);
  }
  const qtyStr = String(rawQty);
  if (isNaN(Number(qtyStr)) || Number(qtyStr) <= 0) {
    error(`Order ${idx}: "quantity" must be a positive number.`);
  }

  const rawPrice = order.price ?? order.order_price ?? order.p;
  if (PRICE_REQUIRED_TYPES.includes(upperType)) {
    if (rawPrice === undefined || rawPrice === null) {
      error(`Order ${idx}: "price" is required for ${upperType} orders.`);
    }
    if (isNaN(Number(rawPrice)) || Number(rawPrice) <= 0) {
      error(`Order ${idx}: "price" must be a positive number.`);
    }
  }

  const rawClientId = order.client_order_id ?? order.clientOrderId;

  return {
    symbol: normalizeSymbol(symbol),
    order_type: upperType,
    side: side.toUpperCase(),
    order_quantity: qtyStr,
    ...(rawPrice !== undefined && rawPrice !== null ? { order_price: String(rawPrice) } : {}),
    ...(rawClientId !== undefined ? { client_order_id: String(rawClientId) } : {}),
  };
}

export async function batchPlace(
  ordersInput: string,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  let rawOrders: RawBatchOrder[];

  try {
    if (existsSync(ordersInput)) {
      const content = readFileSync(ordersInput, 'utf-8');
      rawOrders = JSON.parse(content);
    } else {
      rawOrders = JSON.parse(ordersInput);
    }
  } catch {
    error('Invalid JSON. Provide a valid JSON array or a path to a JSON file.');
  }

  if (!Array.isArray(rawOrders) || rawOrders.length === 0) {
    error('Orders must be a non-empty array.');
  }

  if (rawOrders.length > 10) {
    error('Maximum 10 orders allowed per batch.');
  }

  const normalizedOrders = rawOrders.map((order, i) => normalizeBatchOrder(order, i));

  const { client } = await createAuthenticatedClient(accountId, network);

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
  if (orderIds.length === 0) {
    error('At least one order ID is required.');
  }

  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await client.cancelBatchOrders(orderIds);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function batchCancelByClientId(
  clientOrderIds: string[],
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  if (clientOrderIds.length === 0) {
    error('At least one client order ID is required.');
  }

  if (clientOrderIds.length > 10) {
    error('Maximum 10 client order IDs allowed per batch.');
  }

  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await client.cancelBatchOrdersByClientIds(clientOrderIds);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function cancelByClientId(
  clientOrderId: string,
  symbol: string,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await client.cancelOrderByClientId(clientOrderId, symbol);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function getOrder(
  orderId: string | undefined,
  clientOrderId: string | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  if (!orderId && !clientOrderId) {
    error('Provide either an order ID (positional) or --client-order-id.');
  }

  const { client } = await createAuthenticatedClient(accountId, network);

  const resolvedClientOrderId = clientOrderId ?? (/^\d+$/.test(orderId!) ? undefined : orderId);
  const resolvedOrderId = /^\d+$/.test(orderId!) ? orderId : undefined;

  try {
    if (resolvedClientOrderId) {
      const result = await client.getOrderByClientId(resolvedClientOrderId);
      output(result, format);
    } else if (resolvedOrderId) {
      const result = await client.getOrderByOrderId(resolvedOrderId);
      output(result, format);
    } else {
      error(
        'Could not resolve order identifier. Provide a numeric order ID or use --client-order-id.'
      );
    }
  } catch (err) {
    handleError(err);
  }
}

export async function orderTrades(
  orderId: string,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await client.getOrderTrades(orderId);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
