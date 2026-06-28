require('dotenv').config();
const { app, initApp } = require('./app');
const PORT = process.env.PORT || 3000;

initApp().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Haki Kenya running at http://localhost:${PORT}`);
  });
}).catch(console.error);
