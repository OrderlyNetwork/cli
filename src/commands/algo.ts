import { createAuthenticatedClient } from '../lib/account-select.js';
import { output, error, handleError, OutputFormat } from '../lib/output.js';
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
  price: string | undefined,
  tpTriggerPrice: string | undefined,
  tpPrice: string | undefined,
  slTriggerPrice: string | undefined,
  slPrice: string | undefined,
  reduceOnly: boolean | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const validSide = side.toUpperCase();
  if (!VALID_SIDES.includes(validSide)) {
    error(`Invalid side. Use ${VALID_SIDES.join(' or ')}.`);
  }

  const validAlgoType = algoType.toUpperCase();
  if (!VALID_ALGO_TYPES.includes(validAlgoType)) {
    error(`Invalid algo type. Use one of: ${VALID_ALGO_TYPES.join(', ')}`);
  }

  if (validAlgoType === 'TRAILING_STOP') {
    if (!callbackRate) {
      error('--callback-rate is required for TRAILING_STOP orders.');
    }
  } else if (validAlgoType === 'TP_SL' || validAlgoType === 'POSITIONAL_TP_SL') {
    if (!tpTriggerPrice && !slTriggerPrice) {
      error(
        'At least one of --tp-trigger-price or --sl-trigger-price is required for TP_SL/POSITIONAL_TP_SL orders.'
      );
    }
  } else if (validAlgoType === 'STOP') {
    if (!triggerPrice) {
      error('--trigger-price is required for STOP orders.');
    }
  } else if (validAlgoType === 'BRACKET') {
    if (!triggerPrice) {
      error('--trigger-price is required for BRACKET orders.');
    }
    if (!tpTriggerPrice && !slTriggerPrice) {
      error(
        'At least one of --tp-trigger-price or --sl-trigger-price is required for BRACKET orders.'
      );
    }
  }

  const { client } = await createAuthenticatedClient(accountId, network);

  if (
    (validAlgoType === 'TP_SL' ||
      validAlgoType === 'POSITIONAL_TP_SL' ||
      validAlgoType === 'BRACKET') &&
    (tpTriggerPrice || slTriggerPrice)
  ) {
    let markPrice: number | undefined;
    try {
      const raw = (await client.getMarketPrice(symbol.toUpperCase())) as Record<string, unknown>;
      const marketData = (raw?.data as Record<string, unknown>) || raw;
      markPrice = marketData?.mark_price as number | undefined;
    } catch {
      // skip validation if mark price unavailable
    }

    if (markPrice !== undefined) {
      const tp = tpTriggerPrice ? Number(tpTriggerPrice) : undefined;
      const sl = slTriggerPrice ? Number(slTriggerPrice) : undefined;

      if (validSide === 'BUY') {
        if (tp !== undefined && tp <= markPrice) {
          error(
            `Take-profit trigger price (${tp}) must be above current mark price (${markPrice}) for a BUY/long position.`
          );
        }
        if (sl !== undefined && sl >= markPrice) {
          error(
            `Stop-loss trigger price (${sl}) must be below current mark price (${markPrice}) for a BUY/long position.`
          );
        }
      } else {
        if (tp !== undefined && tp >= markPrice) {
          error(
            `Take-profit trigger price (${tp}) must be below current mark price (${markPrice}) for a SELL/short position.`
          );
        }
        if (sl !== undefined && sl <= markPrice) {
          error(
            `Stop-loss trigger price (${sl}) must be above current mark price (${markPrice}) for a SELL/short position.`
          );
        }
      }
    }
  }

  try {
    let result;

    if (validAlgoType === 'TP_SL' || validAlgoType === 'POSITIONAL_TP_SL') {
      const childOrders: Array<{
        symbol: string;
        algo_type: string;
        side: string;
        type: string;
        trigger_price: string;
        price?: string;
        reduce_only: boolean;
      }> = [];

      const oppositeSide = validSide === 'BUY' ? 'SELL' : 'BUY';

      if (tpTriggerPrice) {
        const tpOrder: {
          symbol: string;
          algo_type: string;
          side: string;
          type: string;
          trigger_price: string;
          price?: string;
          reduce_only: boolean;
        } = {
          symbol: symbol.toUpperCase(),
          algo_type: 'TAKE_PROFIT',
          side: oppositeSide,
          type:
            validAlgoType === 'POSITIONAL_TP_SL' ? 'CLOSE_POSITION' : tpPrice ? 'LIMIT' : 'MARKET',
          trigger_price: tpTriggerPrice,
          reduce_only: true,
        };
        if (tpPrice) tpOrder.price = tpPrice;
        childOrders.push(tpOrder);
      }

      if (slTriggerPrice) {
        const slOrder: {
          symbol: string;
          algo_type: string;
          side: string;
          type: string;
          trigger_price: string;
          price?: string;
          reduce_only: boolean;
        } = {
          symbol: symbol.toUpperCase(),
          algo_type: 'STOP_LOSS',
          side: oppositeSide,
          type:
            validAlgoType === 'POSITIONAL_TP_SL' ? 'CLOSE_POSITION' : slPrice ? 'LIMIT' : 'MARKET',
          trigger_price: slTriggerPrice,
          reduce_only: true,
        };
        if (slPrice) slOrder.price = slPrice;
        childOrders.push(slOrder);
      }

      result = await client.placeAlgoOrder({
        symbol: symbol.toUpperCase(),
        algoType: validAlgoType,
        quantity: validAlgoType === 'POSITIONAL_TP_SL' ? undefined : quantity,
        childOrders,
      });
    } else if (validAlgoType === 'BRACKET') {
      const oppositeSide = validSide === 'BUY' ? 'SELL' : 'BUY';

      const tpslChildOrders: Array<{
        symbol: string;
        algo_type: string;
        side: string;
        type: string;
        trigger_price: string;
        price?: string;
        reduce_only: boolean;
      }> = [];

      if (tpTriggerPrice) {
        const tpOrder: {
          symbol: string;
          algo_type: string;
          side: string;
          type: string;
          trigger_price: string;
          price?: string;
          reduce_only: boolean;
        } = {
          symbol: symbol.toUpperCase(),
          algo_type: 'TAKE_PROFIT',
          side: oppositeSide,
          type: tpPrice ? 'LIMIT' : 'MARKET',
          trigger_price: tpTriggerPrice,
          reduce_only: true,
        };
        if (tpPrice) tpOrder.price = tpPrice;
        tpslChildOrders.push(tpOrder);
      }

      if (slTriggerPrice) {
        const slOrder: {
          symbol: string;
          algo_type: string;
          side: string;
          type: string;
          trigger_price: string;
          price?: string;
          reduce_only: boolean;
        } = {
          symbol: symbol.toUpperCase(),
          algo_type: 'STOP_LOSS',
          side: oppositeSide,
          type: slPrice ? 'LIMIT' : 'MARKET',
          trigger_price: slTriggerPrice,
          reduce_only: true,
        };
        if (slPrice) slOrder.price = slPrice;
        tpslChildOrders.push(slOrder);
      }

      const orderPayload: {
        symbol: string;
        type: string;
        algoType: string;
        side: string;
        quantity: string;
        triggerPrice: string;
        price?: string;
        childOrders: Array<{
          symbol: string;
          algo_type: string;
          quantity: string;
          child_orders: Array<{
            symbol: string;
            algo_type: string;
            side: string;
            type: string;
            trigger_price: string;
            price?: string;
            reduce_only: boolean;
          }>;
        }>;
      } = {
        symbol: symbol.toUpperCase(),
        type: price ? 'LIMIT' : 'MARKET',
        algoType: validAlgoType,
        side: validSide,
        quantity,
        triggerPrice: triggerPrice!,
        childOrders: [
          {
            symbol: symbol.toUpperCase(),
            algo_type: 'TP_SL',
            quantity,
            child_orders: tpslChildOrders,
          },
        ],
      };

      if (price) {
        orderPayload.price = price;
      }

      result = await client.placeAlgoOrder(orderPayload);
    } else {
      const orderPayload: {
        symbol: string;
        type: string;
        algoType: string;
        side: string;
        quantity: string;
        triggerPrice?: string;
        price?: string;
        callbackRate?: string;
        reduceOnly?: boolean;
      } = {
        symbol: symbol.toUpperCase(),
        type: price ? 'LIMIT' : 'MARKET',
        algoType: validAlgoType,
        side: validSide,
        quantity,
      };

      if (triggerPrice) {
        orderPayload.triggerPrice = triggerPrice;
      }
      if (price) {
        orderPayload.price = price;
      }
      if (callbackRate) {
        orderPayload.callbackRate = callbackRate;
      }
      if (reduceOnly) {
        orderPayload.reduceOnly = true;
      }

      result = await client.placeAlgoOrder(orderPayload);
    }

    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function cancelAlgoOrder(
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
      const orderRes = await client.findAlgoOrderById(orderId);
      if (!orderRes.success || !orderRes.data) {
        error(`Algo order ${orderId} not found.`);
      }
      orderSymbol = orderRes.data.symbol;
    } catch (err) {
      handleError(err);
    }
  }

  try {
    const result = await client.cancelAlgoOrder(orderId, orderSymbol!);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function cancelAllAlgoOrders(
  symbol: string | undefined,
  algoType: string | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await client.cancelAllAlgoOrders(symbol, algoType);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function editAlgoOrder(
  orderId: string,
  symbol: string | undefined,
  price: string | undefined,
  quantity: string | undefined,
  triggerPrice: string | undefined,
  callbackRate: string | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  if (!price && !quantity && !triggerPrice && !callbackRate) {
    error('At least one of --price, --quantity, --trigger-price, or --callback-rate is required.', [
      'Examples:',
      '  orderly algo-order-edit 123456 --price 2500',
      '  orderly algo-order-edit 123456 --quantity 0.02',
      '  orderly algo-order-edit 123456 --trigger-price 1500',
      '  orderly algo-order-edit 123456 --callback-rate 0.03',
    ]);
  }

  const { client } = await createAuthenticatedClient(accountId, network);

  let orderSymbol = symbol;
  if (!orderSymbol) {
    try {
      const orderRes = await client.findAlgoOrderById(orderId);
      if (!orderRes.success || !orderRes.data) {
        error(`Algo order ${orderId} not found.`);
      }
      orderSymbol = orderRes.data.symbol;
    } catch (err) {
      handleError(err);
    }
  }

  try {
    const updates: {
      price?: number;
      quantity?: number;
      trigger_price?: number;
      callback_rate?: number;
    } = {};
    if (price) updates.price = Number(price);
    if (quantity) updates.quantity = Number(quantity);
    if (triggerPrice) updates.trigger_price = Number(triggerPrice);
    if (callbackRate) updates.callback_rate = Number(callbackRate);

    const result = await client.editAlgoOrder(orderId, updates, orderSymbol!);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function listAlgoOrders(
  symbol: string | undefined,
  status: string | undefined,
  page: number | undefined,
  size: number | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await client.getAlgoOrders(symbol, status, page, size);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}

export async function algoOrderTrades(
  orderId: string,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const result = await client.getAlgoOrderTrades(orderId);
    output(result, format);
  } catch (err) {
    handleError(err);
  }
}
