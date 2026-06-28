const { app, initApp } = require('../app');
let ready = false;

app.use((req, res, next) => {
  if (ready) return next();
  initApp().then(() => { ready = true; next(); }).catch(err => {
    console.error('Init error:', err);
    res.status(500).send('Server initialization failed');
  });
});

module.exports = app;
