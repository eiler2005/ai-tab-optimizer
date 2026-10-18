import type { MessageRequest, MessageResponse } from '@shared/types';

export async function workspaceMessage<T>(message: MessageRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as MessageResponse;
  if (!response?.success) throw new Error(response && 'error' in response ? response.error : 'No response from extension');
  return response.data as T;
}
