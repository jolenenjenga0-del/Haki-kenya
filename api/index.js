const { app, initApp } = require('../app');

let initialized = false;

app.use(async (req, res, next) => {
  if (!initialized) {
    try {
      await initApp();
      initialized = true;
    } catch (err) {
      console.error('Init error:', err);
      return res.status(500).send('Initialization failed');
    }
  }
  next();
});

module.exports = app;
