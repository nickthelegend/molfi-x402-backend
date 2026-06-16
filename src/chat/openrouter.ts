import { Response } from 'express';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { sseWrite } from '../lib/sse.js';

export async function streamOpenRouter(
  modelOpenRouterId: string,
  messages: Array<{ role: string; content: string }>,
  res: Response
) {
  const url = `${env.OPENROUTER_BASE_URL}/chat/completions`;

  logger.debug(`Streaming from OpenRouter model: ${modelOpenRouterId}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': env.OPENROUTER_REFERER,
      'X-Title': env.OPENROUTER_TITLE,
    },
    body: JSON.stringify({
      model: modelOpenRouterId,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`OpenRouter error response: ${response.status} - ${errorText}`);
    throw new Error(`OpenRouter API failed with status ${response.status}`);
  }

  if (!response.body) {
    throw new Error('OpenRouter returned an empty response body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('data: ')) {
          const rawData = trimmed.slice(6);
          if (rawData === '[DONE]') {
            continue;
          }
          try {
            const parsed = JSON.parse(rawData);
            sseWrite(res, parsed);
          } catch (e) {
            logger.warn(`Failed to parse OpenRouter SSE frame: ${trimmed}`);
          }
        }
      }
    }
  } catch (error) {
    logger.error(error as Error, 'Error while reading stream from OpenRouter');
    throw error;
  }
}
