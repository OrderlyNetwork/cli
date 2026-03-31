import { createAuthenticatedClient } from '../lib/account-select.js';
import { output, handleError, OutputFormat } from '../lib/output.js';
import { Network } from '../types.js';

export async function inbox(
  type: string | undefined,
  page: number | undefined,
  size: number | undefined,
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const data = await client.getNotificationInbox(type, page, size);
    output(data, format);
  } catch (err) {
    handleError(err);
  }
}

export async function inboxUnread(
  accountId: string | undefined,
  network: Network,
  format: OutputFormat = 'json'
): Promise<void> {
  const { client } = await createAuthenticatedClient(accountId, network);

  try {
    const data = await client.getNotificationInboxUnread();
    output(data, format);
  } catch (err) {
    handleError(err);
  }
}
