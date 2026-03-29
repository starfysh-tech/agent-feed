import http from 'node:http';

export function createUIServer({ db }) {
  let server = null;
  let _port = null;

  const instance = {
    get port() {
      return _port;
    },

    async listen(configPort = 3000) {
      server = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('Agent Feed UI -- coming soon');
      });

      await new Promise((resolve, reject) => {
        server.listen(configPort, 'localhost', (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      _port = server.address().port;
    },

    async close() {
      if (!server) return;
      await new Promise((resolve) => server.close(resolve));
      server = null;
    },
  };

  return instance;
}
