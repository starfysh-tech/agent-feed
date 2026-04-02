import http from 'node:http';

const server = http.createServer((req, res) => {
  console.log('\n--- REQUEST ---');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));

  // Drain request body
  req.resume();
  req.on('end', () => {
    // Return SSE streaming response (what Claude Code expects)
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    });

    const events = [
      { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [], usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ];

    for (const event of events) {
      res.write('event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n');
    }
    res.end();
  });
});

server.listen(19999, () => console.log('Header capture server on :19999'));
