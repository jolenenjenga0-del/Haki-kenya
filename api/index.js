let app;
try {
  app = require('../app').app;
} catch (e) {
  const http = require('http');
  app = (req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Init Error: ' + (e?.stack || e?.message || e));
  };
}
module.exports = app;
