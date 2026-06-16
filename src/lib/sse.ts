import { Response } from 'express';

export function sseInit(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
}

export function sseWrite(res: Response, data: unknown) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function sseKeepAlive(res: Response) {
  res.write(': keep-alive\n\n');
}

export function sseEnd(res: Response) {
  res.write('data: [DONE]\n\n');
  res.end();
}
