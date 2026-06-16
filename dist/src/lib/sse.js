export function sseInit(res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
}
export function sseWrite(res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}
export function sseKeepAlive(res) {
    res.write(': keep-alive\n\n');
}
export function sseEnd(res) {
    res.write('data: [DONE]\n\n');
    res.end();
}
