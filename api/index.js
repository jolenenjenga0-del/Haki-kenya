const { app, initApp } = require('../app');
let ready = false;

async function handler(req, res) {
  if (!ready) {
    await initApp();
    ready = true;
  }
  return app(req, res);
}

module.exports = handler;
