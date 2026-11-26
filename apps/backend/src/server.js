const http = require('http');
const { handleApiRequest } = require('./routes/apiRoutes');

const PORT = Number(process.env.PORT || 3333);

const server = http.createServer((req, res) => {
  handleApiRequest(req, res);
});

server.listen(PORT, () => {
  console.log(`[BikApp Backend - Fase 3] Servidor rodando em http://localhost:${PORT}`);
  console.log(`Endpoints disponíveis:`);
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  GET  http://localhost:${PORT}/api/orders`);
  console.log(`  POST http://localhost:${PORT}/api/orders`);
  console.log(`  POST http://localhost:${PORT}/api/orders/:id/complete`);
  console.log(`  GET  http://localhost:${PORT}/api/ranking`);
});