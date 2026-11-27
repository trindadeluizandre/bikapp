const fs = require('fs');
const path = require('path');
const { BIKE_RULES } = require('../config/rules');
const { calculateDeliveryPricing, calculateRescuePricing } = require('../services/pricingEngine');
const { buildWeeklyRanking } = require('../services/rankingEngine');
const { generateWeeklyPayoutBatch, markWeeklyBatchPaid } = require('../services/financeEngine');
const {
  FOZ_NEIGHBORHOODS,
  getNeighborhoodCoords,
  estimateBikeDistanceKm,
  updateCourierLocation,
  getLiveMapSnapshot,
} = require('../services/locationService');
const { readStore, writeStore, backupStore, resetDevStore } = require('../services/storeService');

const WEB_DIR = path.resolve(__dirname, '../../../web-lojista');
const MOBILE_DIR = path.resolve(__dirname, '../../../mobile');
const CLIENT_DIR = path.resolve(__dirname, '../../../client-app');
const ADMIN_DIR = path.resolve(__dirname, '../../../web-admin');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!body.trim()) {
        return resolve({});
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('JSON inválido no corpo da requisição.'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApiRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost:3333'}`);
  const pathname = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // Rotas estáticas — Painel Web do Lojista
  if (method === 'GET' && (pathname === '/' || pathname === '/painel')) {
    const html = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (method === 'GET' && pathname === '/src/styles/panel.css') {
    const css = fs.readFileSync(path.join(WEB_DIR, 'src/styles/panel.css'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
    return res.end(css);
  }

  if (method === 'GET' && pathname === '/src/services/panelApp.js') {
    const js = fs.readFileSync(path.join(WEB_DIR, 'src/services/panelApp.js'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    return res.end(js);
  }

  // Rotas estáticas — App Mobile do Entregador
  if (method === 'GET' && pathname === '/app') {
    const html = fs.readFileSync(path.join(MOBILE_DIR, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (method === 'GET' && pathname === '/app/manifest.json') {
    const manifest = fs.readFileSync(path.join(MOBILE_DIR, 'manifest.json'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
    return res.end(manifest);
  }

  if (method === 'GET' && pathname === '/app/src/styles/courier.css') {
    const css = fs.readFileSync(path.join(MOBILE_DIR, 'src/styles/courier.css'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
    return res.end(css);
  }

  if (method === 'GET' && pathname === '/app/src/services/courierApp.js') {
    const js = fs.readFileSync(path.join(MOBILE_DIR, 'src/services/courierApp.js'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    return res.end(js);
  }

  // Rotas estáticas — App do Cliente Usuário (/cliente)
  if (method === 'GET' && pathname === '/cliente') {
    const html = fs.readFileSync(path.join(CLIENT_DIR, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (method === 'GET' && pathname === '/cliente/src/styles/client.css') {
    const css = fs.readFileSync(path.join(CLIENT_DIR, 'src/styles/client.css'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
    return res.end(css);
  }

  if (method === 'GET' && pathname === '/cliente/src/services/clientApp.js') {
    const js = fs.readFileSync(path.join(CLIENT_DIR, 'src/services/clientApp.js'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    return res.end(js);
  }

  // Rotas estáticas — Sistema Web Administrativo BikApp (/admin)
  if (method === 'GET' && pathname === '/admin') {
    const html = fs.readFileSync(path.join(ADMIN_DIR, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (method === 'GET' && pathname === '/admin/src/styles/admin.css') {
    const css = fs.readFileSync(path.join(ADMIN_DIR, 'src/styles/admin.css'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
    return res.end(css);
  }

  if (method === 'GET' && pathname === '/admin/src/services/adminApp.js') {
    const js = fs.readFileSync(path.join(ADMIN_DIR, 'src/services/adminApp.js'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    return res.end(js);
  }

  try {
    if (method === 'GET' && pathname === '/health') {
      const store = readStore();
      return sendJson(res, 200, {
        status: 'ok',
        service: 'bikapp-backend',
        phase: 8,
        city: store.city,
        neighborhoods: FOZ_NEIGHBORHOODS,
        rules: {
          maxRadiusKm: BIKE_RULES.maxRadiusKm,
          maxWeightKg: BIKE_RULES.maxWeightKg,
          freeWaitMinutes: BIKE_RULES.freeWaitMinutes,
        },
        funds: store.funds,
        counts: {
          customers: store.customers.length,
          merchants: store.merchants.length,
          products: store.products.length,
          couriers: store.couriers.length,
          orders: store.orders.length,
          openSosAlerts: (store.sosAlerts || []).filter((s) => s.status === 'ABERTO').length,
        },
        totalOrders: store.orders.length,
      });
    }

    // --- CLIENTES ---
    if (method === 'GET' && pathname === '/api/customers') {
      const store = readStore();
      return sendJson(res, 200, { customers: store.customers });
    }

    if (method === 'POST' && pathname === '/api/customers') {
      const body = await parseBody(req);
      if (!body.name || !body.address) {
        return sendJson(res, 400, { error: 'Nome e endereço do cliente são obrigatórios.' });
      }
      const rawCpfDigits = String(body.cpf || '').replace(/\D/g, '');
      if (body.cpf !== undefined && rawCpfDigits.length > 0 && rawCpfDigits.length !== 11) {
        return sendJson(res, 400, { error: 'Informe um CPF válido com 11 dígitos.' });
      }
      const store = readStore();
      const existingCustomer = body.id ? store.customers.find((c) => c.id === body.id) : null;
      const effectiveCpfDigits = rawCpfDigits.length === 11
        ? rawCpfDigits
        : String(existingCustomer?.cpf || '').replace(/\D/g, '');
      const cpfLast4 = effectiveCpfDigits.length === 11 ? effectiveCpfDigits.slice(-4) : null;

      const coords = getNeighborhoodCoords(body.neighborhood);
      const customer = {
        id: body.id || `cust-${Date.now()}`,
        name: String(body.name).trim(),
        phone: String(body.phone || '').trim(),
        cpf: effectiveCpfDigits || '',
        cpfLast4,
        address: String(body.address).trim(),
        neighborhood: String(body.neighborhood || 'CENTRO').toUpperCase(),
        lat: body.lat !== undefined ? Number(body.lat) : coords.lat,
        lng: body.lng !== undefined ? Number(body.lng) : coords.lng,
        createdAt: new Date().toISOString(),
      };

      const existingIdx = store.customers.findIndex((c) => c.id === customer.id);
      if (existingIdx >= 0) {
        store.customers[existingIdx] = { ...store.customers[existingIdx], ...customer };
      } else {
        store.customers.unshift(customer);
      }
      writeStore(store);
      return sendJson(res, 201, { saved: true, customer });
    }

    // --- LOJISTAS / EMPRESAS PARCEIRAS ---
    if (method === 'GET' && pathname === '/api/merchants') {
      const store = readStore();
      return sendJson(res, 200, { merchants: store.merchants });
    }

    if (method === 'POST' && pathname === '/api/merchants') {
      const body = await parseBody(req);
      if (!body.name || !body.address) {
        return sendJson(res, 400, { error: 'Nome do estabelecimento e endereço são obrigatórios.' });
      }
      const store = readStore();
      const coords = getNeighborhoodCoords(body.neighborhood);
      const merchant = {
        id: body.id || `merch-${Date.now()}`,
        name: String(body.name).trim(),
        cnpjOrCpf: String(body.cnpjOrCpf || '').trim(),
        category: body.category || 'FARMACIA_LEVE',
        address: String(body.address).trim(),
        neighborhood: String(body.neighborhood || 'CENTRO').toUpperCase(),
        lat: body.lat !== undefined ? Number(body.lat) : coords.lat,
        lng: body.lng !== undefined ? Number(body.lng) : coords.lng,
        approved: body.approved !== undefined ? Boolean(body.approved) : true,
        createdAt: new Date().toISOString(),
      };

      const existingIdx = store.merchants.findIndex((m) => m.id === merchant.id);
      if (existingIdx >= 0) {
        store.merchants[existingIdx] = { ...store.merchants[existingIdx], ...merchant };
      } else {
        store.merchants.unshift(merchant);
      }
      writeStore(store);
      return sendJson(res, 201, { saved: true, merchant });
    }

    const approveMerchantMatch = pathname.match(/^\/api\/merchants\/([^/]+)\/approve$/);
    if (method === 'POST' && approveMerchantMatch) {
      const merchantId = approveMerchantMatch[1];
      const body = await parseBody(req);
      const store = readStore();
      const merchant = store.merchants.find((m) => m.id === merchantId);
      if (!merchant) {
        return sendJson(res, 404, { error: 'Estabelecimento não encontrado.' });
      }
      merchant.approved = body.approved !== undefined ? Boolean(body.approved) : !merchant.approved;
      writeStore(store);
      return sendJson(res, 200, { updated: true, merchant });
    }

    // --- CATÁLOGO DE PRODUTOS LEVES ---
    if (method === 'GET' && pathname === '/api/products') {
      const store = readStore();
      const merchantId = url.searchParams.get('merchantId');
      const list = merchantId
        ? store.products.filter((p) => p.merchantId === merchantId)
        : store.products;
      return sendJson(res, 200, { products: list });
    }

    if (method === 'POST' && pathname === '/api/products') {
      const body = await parseBody(req);
      if (!body.merchantId || !body.name) {
        return sendJson(res, 400, { error: 'Estabelecimento e nome do produto são obrigatórios.' });
      }
      const weightKg = Number(body.weightKg ?? 0.5);
      if (weightKg > BIKE_RULES.maxWeightKg) {
        return sendJson(res, 400, {
          error: `Produto acima do limite máximo do modal bike (${BIKE_RULES.maxWeightKg} kg).`,
        });
      }

      const store = readStore();
      const product = {
        id: body.id || `prod-${Date.now()}`,
        merchantId: body.merchantId,
        name: String(body.name).trim(),
        category: body.category || 'FARMACIA_LEVE',
        weightKg,
        priceBRL: Number(body.priceBRL ?? 0),
        active: body.active !== false,
      };

      const existingIdx = store.products.findIndex((p) => p.id === product.id);
      if (existingIdx >= 0) {
        store.products[existingIdx] = { ...store.products[existingIdx], ...product };
      } else {
        store.products.unshift(product);
      }
      writeStore(store);
      return sendJson(res, 201, { saved: true, product });
    }

    const toggleProductMatch = pathname.match(/^\/api\/products\/([^/]+)\/toggle$/);
    if (method === 'POST' && toggleProductMatch) {
      const productId = toggleProductMatch[1];
      const store = readStore();
      const product = store.products.find((p) => p.id === productId);
      if (!product) {
        return sendJson(res, 404, { error: 'Produto não encontrado.' });
      }
      product.active = !product.active;
      writeStore(store);
      return sendJson(res, 200, { updated: true, product });
    }

    // --- CICLISTAS ---
    if (method === 'GET' && pathname === '/api/couriers') {
      const store = readStore();
      return sendJson(res, 200, { couriers: store.couriers });
    }

    if (method === 'POST' && pathname === '/api/couriers') {
      const body = await parseBody(req);
      if (!body.name) {
        return sendJson(res, 400, { error: 'Nome do ciclista é obrigatório.' });
      }
      const store = readStore();
      const id = body.id || `bike-${Date.now()}`;
      const existing = store.couriers.find((c) => c.id === id);

      if (existing) {
        existing.name = String(body.name).trim();
        if (body.phone !== undefined) existing.phone = String(body.phone).trim();
        if (body.pixKey !== undefined) existing.pixKey = String(body.pixKey).trim();
        writeStore(store);
        return sendJson(res, 200, { saved: true, courier: existing });
      }

      const newCourier = {
        id,
        name: String(body.name).trim(),
        phone: String(body.phone || '').trim(),
        pixKey: String(body.pixKey || '').trim(),
        approved: true,
        online: true,
        city: store.city || 'Foz do Iguaçu',
        previousRank: store.couriers.length + 1,
        metrics: {
          completedDeliveries: 0,
          onTimeDeliveries: 0,
          fiveStarRatings: 0,
          peakOrRainDeliveries: 0,
          unjustifiedCancels: 0,
          severeLateDeliveries: 0,
        },
      };
      store.couriers.push(newCourier);
      writeStore(store);
      return sendJson(res, 201, { saved: true, courier: newCourier });
    }

    const approveCourierMatch = pathname.match(/^\/api\/couriers\/([^/]+)\/approve$/);
    if (method === 'POST' && approveCourierMatch) {
      const courierId = approveCourierMatch[1];
      const body = await parseBody(req);
      const store = readStore();
      const courier = store.couriers.find((c) => c.id === courierId);
      if (!courier) {
        return sendJson(res, 404, { error: 'Ciclista não encontrado.' });
      }
      courier.approved = body.approved !== undefined ? Boolean(body.approved) : !courier.approved;
      writeStore(store);
      return sendJson(res, 200, { updated: true, courier });
    }

    const availabilityCourierMatch = pathname.match(/^\/api\/couriers\/([^/]+)\/availability$/);
    if (method === 'POST' && availabilityCourierMatch) {
      const courierId = availabilityCourierMatch[1];
      const body = await parseBody(req);
      const store = readStore();
      const courier = store.couriers.find((c) => c.id === courierId);
      if (!courier) {
        return sendJson(res, 404, { error: 'Ciclista não encontrado.' });
      }
      const currentlyOnline = courier.online !== false;
      courier.online = body.online !== undefined ? Boolean(body.online) : !currentlyOnline;
      writeStore(store);
      return sendJson(res, 200, { updated: true, courier });
    }

    // --- LOCALIZAÇÃO E MAPA ---
    if (method === 'GET' && pathname === '/api/location') {
      const snapshot = getLiveMapSnapshot();
      return sendJson(res, 200, snapshot);
    }

    if (method === 'POST' && pathname === '/api/location') {
      const body = await parseBody(req);
      const updated = updateCourierLocation({
        courierId: body.courierId || 'bike-andre',
        name: body.name,
        lat: body.lat,
        lng: body.lng,
        accuracy: body.accuracy ?? null,
        activeOrderId: body.activeOrderId ?? null,
      });
      return sendJson(res, 200, {
        updated: true,
        location: updated,
      });
    }

    // --- SOS / SEGURO EM ROTA E CONTINGÊNCIA ---
    if (method === 'GET' && pathname === '/api/sos') {
      const store = readStore();
      return sendJson(res, 200, {
        alerts: store.sosAlerts || [],
        insurancePool: store.funds.insurancePool,
      });
    }

    if (method === 'POST' && pathname === '/api/sos') {
      const body = await parseBody(req);
      const store = readStore();
      const courierId = body.courierId || 'bike-andre';
      const courier = store.couriers.find((c) => c.id === courierId);
      const cargoCondition = body.cargoCondition === 'DANIFICADA' ? 'DANIFICADA' : 'INTACTA';

      const inactiveStatuses = [
        'CONCLUIDO',
        'RECUSADO_PELA_LOJA',
        'INCIDENTE_EM_ROTA',
        'RESGATE_EM_ANDAMENTO',
        'CANCELADO_INCIDENTE_REEMBOLSADO',
        'ENCERRADO_POR_INCIDENTE_RECOMPRA',
      ];

      const activeOrder = body.activeOrderId
        ? (store.orders || []).find((o) => o.id === body.activeOrderId && !inactiveStatuses.includes(o.status))
        : (store.orders || []).find((o) => o.courierId === courierId && !inactiveStatuses.includes(o.status));

      const lat = body.lat !== undefined && body.lat !== null ? Number(body.lat) : -25.5478;
      const lng = body.lng !== undefined && body.lng !== null ? Number(body.lng) : -54.5882;

      updateCourierLocation({
        courierId,
        name: courier?.name || body.courierName || courierId,
        lat,
        lng,
        accuracy: body.accuracy ?? null,
        activeOrderId: activeOrder?.id || null,
      });

      const nowIso = new Date().toISOString();
      const alertId = `sos-${Date.now()}`;
      let rescueCalc = null;
      let firstCourierProtectedPayout = 0;

      if (activeOrder) {
        const previousStage = activeOrder.status;
        const originalP1 = Number(activeOrder.pricing?.ponta1_entregador?.totalPayout || 8);

        if (previousStage === 'EM_ROTA_ENTREGA') {
          firstCourierProtectedPayout = Number((originalP1 * 0.5).toFixed(2));
        }

        if (cargoCondition === 'INTACTA') {
          rescueCalc = calculateRescuePricing(activeOrder.pricing, 5);
          activeOrder.pricing.ponta1_entregador.totalPayout = rescueCalc.rescueTotalPayout;
          activeOrder.pricing.ponta1_entregador.rescueBonusApplied = rescueCalc.fundSubsidyRequired;
          activeOrder.isRescueAvailable = true;
        } else {
          activeOrder.isRescueAvailable = false;
        }

        activeOrder.status = 'INCIDENTE_EM_ROTA';
        activeOrder.incident = {
          sosId: alertId,
          reason: String(body.reason || 'ACIDENTE / QUEDA').trim(),
          cargoCondition,
          firstCourierId: courierId,
          firstCourierName: courier?.name || body.courierName || courierId,
          previousStage,
          pickupLocation: { lat, lng },
          reportedAt: nowIso,
          firstCourierProtectedPayout,
          rescuePricing: rescueCalc,
          clientChoice: null,
          courtesyCreditBRL: 0,
          refundedAmountBRL: 0,
          replacementOrderId: null,
        };
      }

      const alert = {
        id: alertId,
        courierId,
        courierName: courier?.name || body.courierName || courierId,
        courierPhone: courier?.phone || '',
        reason: String(body.reason || 'ACIDENTE / QUEDA').trim(),
        cargoCondition,
        activeOrderId: activeOrder?.id || null,
        activeOrderSummary: activeOrder
          ? `${activeOrder.merchantName} -> ${activeOrder.customerName} (${cargoCondition})`
          : 'Sem corrida ativa no momento',
        lat,
        lng,
        insurancePoolSnapshot: store.funds.insurancePool,
        status: 'ABERTO',
        createdAt: nowIso,
        resolvedAt: null,
      };

      store.sosAlerts = Array.isArray(store.sosAlerts) ? store.sosAlerts : [];
      store.sosAlerts.unshift(alert);
      writeStore(store);

      return sendJson(res, 201, {
        triggered: true,
        alert,
        order: activeOrder || null,
      });
    }

    const resolveSosMatch = pathname.match(/^\/api\/sos\/([^/]+)\/resolve$/);
    if (method === 'POST' && resolveSosMatch) {
      const sosId = resolveSosMatch[1];
      const store = readStore();
      const alert = (store.sosAlerts || []).find((a) => a.id === sosId);
      if (!alert) {
        return sendJson(res, 404, { error: 'Chamado SOS não encontrado.' });
      }
      alert.status = 'ATENDIDO';
      alert.resolvedAt = new Date().toISOString();
      writeStore(store);
      return sendJson(res, 200, { resolved: true, alert });
    }

    const incidentChoiceMatch = pathname.match(/^\/api\/orders\/([^/]+)\/incident-choice$/);
    if (method === 'POST' && incidentChoiceMatch) {
      const orderId = incidentChoiceMatch[1];
      const body = await parseBody(req);
      const choice = body.choice;
      const store = readStore();
      const order = store.orders.find((o) => o.id === orderId);

      if (!order || !order.incident) {
        return sendJson(res, 404, { error: 'Pedido com incidente não encontrado.' });
      }

      const itemsValue = Number(order.pricing?.ponta2_empresa?.orderValue || 0);
      const deliveryFee = Number(
        (
          Number(order.pricing?.ponta1_entregador?.totalPayout || 0) +
          Number(order.pricing?.ponta3_bikapp?.totalFee || 0)
        ).toFixed(2)
      );

      if (choice === 'AGUARDAR_RESGATE') {
        if (order.incident.cargoCondition === 'DANIFICADA') {
          return sendJson(res, 400, {
            error: 'Carga danificada não pode ser entregue; escolha Recompra Segurada ou Reembolso 100%.',
          });
        }
        order.incident.clientChoice = 'AGUARDAR_RESGATE';
        order.incident.courtesyCreditBRL = 5.0;
        order.isRescueAvailable = order.status === 'INCIDENTE_EM_ROTA';
        writeStore(store);
        return sendJson(res, 200, { updated: true, order });
      }

      if (choice === 'CANCELAR_REEMBOLSO') {
        order.incident.clientChoice = 'CANCELAR_REEMBOLSO';
        order.incident.refundedAmountBRL = Number((itemsValue + deliveryFee).toFixed(2));
        order.isRescueAvailable = false;
        order.status = 'CANCELADO_INCIDENTE_REEMBOLSADO';
        writeStore(store);
        return sendJson(res, 200, { updated: true, order });
      }

      if (choice === 'RECOMPRA_SEGURADA') {
        const freshPricing = calculateDeliveryPricing({
          distanceKm: Number(order.distanceKm || 1.5),
          weightKg: Number(order.weightKg || 1.0),
          category: order.category,
          additionalStops: Number(order.additionalStops || 0),
          waitMinutes: 0,
          orderValue: itemsValue,
          isActiveRoute: true,
        });

        const nowIso = new Date().toISOString();
        const replacementOrder = {
          id: `ord-recompra-${Date.now()}`,
          originChannel: 'RECOMPRA_SEGURADA',
          parentIncidentOrderId: order.id,
          customerId: order.customerId,
          customerName: order.customerName,
          customerAddress: order.customerAddress,
          merchantId: order.merchantId,
          merchantName: order.merchantName,
          category: order.category,
          itemsSummary: `[RECOMPRA SEGURADA] ${order.itemsSummary || order.category}`,
          distanceKm: order.distanceKm,
          weightKg: order.weightKg,
          additionalStops: order.additionalStops || 0,
          pickupCoords: order.pickupCoords,
          dropoffCoords: order.dropoffCoords,
          status: 'AGUARDANDO_CONFIRMACAO_LOJA',
          rejectionReason: null,
          courierId: null,
          courierName: null,
          customerRating: null,
          timestamps: {
            createdAt: nowIso,
            storeConfirmedAt: null,
            storeRejectedAt: null,
            acceptedAt: null,
            arrivedPickupAt: null,
            pickedUpAt: null,
            completedAt: null,
          },
          createdAt: nowIso,
          pricing: freshPricing.approved ? freshPricing : order.pricing,
        };

        order.incident.clientChoice = 'RECOMPRA_SEGURADA';
        order.incident.replacementOrderId = replacementOrder.id;
        order.isRescueAvailable = false;
        order.status = 'ENCERRADO_POR_INCIDENTE_RECOMPRA';

        store.orders.unshift(replacementOrder);
        writeStore(store);
        return sendJson(res, 201, { updated: true, order, replacementOrder });
      }

      return sendJson(res, 400, { error: 'Opção de contingência inválida.' });
    }

    // --- PEDIDOS ---
    if (method === 'GET' && pathname === '/api/orders') {
      const store = readStore();
      const customerId = url.searchParams.get('customerId');
      const merchantId = url.searchParams.get('merchantId');
      const originChannel = url.searchParams.get('originChannel');

      let orders = store.orders;
      if (customerId) {
        orders = orders.filter((o) => o.customerId === customerId);
      }
      if (merchantId) {
        orders = orders.filter((o) => o.merchantId === merchantId);
      }
      if (originChannel) {
        orders = orders.filter((o) => o.originChannel === originChannel);
      }

      return sendJson(res, 200, {
        total: orders.length,
        orders,
      });
    }

    if (method === 'POST' && pathname === '/api/orders') {
      const data = await parseBody(req);
      const store = readStore();

      const merchant = data.merchantId
        ? store.merchants.find((m) => m.id === data.merchantId)
        : store.merchants.find((m) => m.name === data.merchantName);

      if (merchant && merchant.approved === false) {
        return sendJson(res, 403, {
          created: false,
          message: 'Estabelecimento aguardando aprovação administrativa para operar.',
        });
      }

      const customer = data.customerId
        ? store.customers.find((c) => c.id === data.customerId)
        : null;

      const pickupCoords = merchant
        ? { lat: merchant.lat, lng: merchant.lng }
        : getNeighborhoodCoords(data.pickupNeighborhood || 'CENTRO');

      const dropoffCoords = customer
        ? { lat: customer.lat, lng: customer.lng }
        : getNeighborhoodCoords(data.dropoffNeighborhood || 'VILA_YOLANDA');

      const computedDistance =
        data.distanceKm !== undefined && data.distanceKm !== null && data.distanceKm !== ''
          ? Number(data.distanceKm)
          : estimateBikeDistanceKm(pickupCoords, dropoffCoords);

      const weightKg = Number(data.weightKg ?? 1.0);
      const additionalStops = Number(data.additionalStops ?? 0);
      const waitMinutes = Number(data.waitMinutes ?? 0);
      const orderValue = Number(data.orderValue ?? 0);
      const category = data.category || merchant?.category || 'FARMACIA_LEVE';

      const pricing = calculateDeliveryPricing({
        distanceKm: computedDistance,
        weightKg,
        category,
        additionalStops,
        waitMinutes,
        orderValue,
        isActiveRoute: data.isActiveRoute !== false,
      });

      if (!pricing.approved) {
        return sendJson(res, 400, {
          created: false,
          message: 'Pedido rejeitado pelas regras do modal bike.',
          pricing,
        });
      }

      const originChannel = data.originChannel || (customer ? 'APP_CLIENTE' : 'BALCAO_LOJISTA');
      if (originChannel === 'APP_CLIENTE' && !customer) {
        return sendJson(res, 400, {
          created: false,
          message: 'Cadastro do cliente obrigatório antes de realizar o pedido.',
        });
      }

      const initialStatus =
        originChannel === 'APP_CLIENTE' ? 'AGUARDANDO_CONFIRMACAO_LOJA' : 'AGUARDANDO_CICLISTA';
      const generatedPickupCode =
        initialStatus === 'AGUARDANDO_CICLISTA'
          ? String(Math.floor(1000 + Math.random() * 9000))
          : null;
      const deliveryPin = customer?.cpfLast4 || (data.deliveryPin ? String(data.deliveryPin).slice(-4) : null);

      const nowIso = new Date().toISOString();
      const newOrder = {
        id: `ord-${Date.now()}`,
        originChannel,
        customerId: customer?.id || data.customerId || null,
        customerName: customer?.name || data.customerName || 'Cliente Balcão',
        customerAddress: customer?.address || data.customerAddress || 'Endereço em Foz do Iguaçu',
        merchantId: merchant?.id || data.merchantId || null,
        merchantName: merchant?.name || data.merchantName || 'Farmácia Parceira',
        pickupAddress: merchant?.address || '',
        pickupNeighborhood: merchant?.neighborhood || 'CENTRO',
        dropoffNeighborhood: customer?.neighborhood || data.dropoffNeighborhood || 'VILA_YOLANDA',
        pickupCode: generatedPickupCode,
        deliveryPin,
        falseReadyReported: false,
        category,
        itemsSummary: data.itemsSummary || '',
        distanceKm: computedDistance,
        weightKg,
        additionalStops,
        pickupCoords,
        dropoffCoords,
        status: initialStatus,
        rejectionReason: null,
        courierId: null,
        courierName: null,
        customerRating: null,
        timestamps: {
          createdAt: nowIso,
          storeConfirmedAt: initialStatus === 'AGUARDANDO_CICLISTA' ? nowIso : null,
          storeReadyAt: initialStatus === 'AGUARDANDO_CICLISTA' ? nowIso : null,
          storeRejectedAt: null,
          acceptedAt: null,
          arrivedPickupAt: null,
          pickedUpAt: null,
          completedAt: null,
        },
        createdAt: nowIso,
        pricing,
      };

      store.orders.unshift(newOrder);
      writeStore(store);

      return sendJson(res, 201, {
        created: true,
        order: newOrder,
      });
    }

    const confirmStoreMatch = pathname.match(/^\/api\/orders\/([^/]+)\/confirm-store$/);
    if (method === 'POST' && confirmStoreMatch) {
      const orderId = confirmStoreMatch[1];
      const store = readStore();
      const order = store.orders.find((o) => o.id === orderId);

      if (!order) {
        return sendJson(res, 404, { error: 'Pedido não encontrado.' });
      }
      if (order.status !== 'AGUARDANDO_CONFIRMACAO_LOJA') {
        return sendJson(res, 409, {
          error: `Pedido não está aguardando confirmação da loja (status atual: ${order.status}).`,
        });
      }

      order.status = 'EM_PREPARO_NA_LOJA';
      order.timestamps = order.timestamps || {};
      order.timestamps.storeConfirmedAt = new Date().toISOString();

      writeStore(store);
      return sendJson(res, 200, {
        confirmed: true,
        order,
      });
    }

    const readyPickupMatch = pathname.match(/^\/api\/orders\/([^/]+)\/ready-pickup$/);
    if (method === 'POST' && readyPickupMatch) {
      const orderId = readyPickupMatch[1];
      const store = readStore();
      const order = store.orders.find((o) => o.id === orderId);

      if (!order) {
        return sendJson(res, 404, { error: 'Pedido não encontrado.' });
      }
      if (order.status !== 'EM_PREPARO_NA_LOJA' && order.status !== 'AGUARDANDO_CONFIRMACAO_LOJA') {
        return sendJson(res, 409, {
          error: `Pedido não pode ser liberado para coleta neste status (${order.status}).`,
        });
      }

      const nowIso = new Date().toISOString();
      order.status = 'AGUARDANDO_CICLISTA';
      order.pickupCode = order.pickupCode || String(Math.floor(1000 + Math.random() * 9000));
      order.timestamps = order.timestamps || {};
      order.timestamps.storeConfirmedAt = order.timestamps.storeConfirmedAt || nowIso;
      order.timestamps.storeReadyAt = nowIso;

      writeStore(store);
      return sendJson(res, 200, {
        ready: true,
        order,
      });
    }

    const rejectStoreMatch = pathname.match(/^\/api\/orders\/([^/]+)\/reject-store$/);
    if (method === 'POST' && rejectStoreMatch) {
      const orderId = rejectStoreMatch[1];
      const body = await parseBody(req);
      const store = readStore();
      const order = store.orders.find((o) => o.id === orderId);

      if (!order) {
        return sendJson(res, 404, { error: 'Pedido não encontrado.' });
      }
      if (order.status !== 'AGUARDANDO_CONFIRMACAO_LOJA' && order.status !== 'EM_PREPARO_NA_LOJA') {
        return sendJson(res, 409, {
          error: `Apenas pedidos antes do despacho podem ser recusados (status atual: ${order.status}).`,
        });
      }

      order.status = 'RECUSADO_PELA_LOJA';
      order.rejectionReason = body.reason || 'Produto indisponível no estoque da loja.';
      order.timestamps = order.timestamps || {};
      order.timestamps.storeRejectedAt = new Date().toISOString();

      writeStore(store);
      return sendJson(res, 200, {
        rejected: true,
        order,
      });
    }

    const notReadyMatch = pathname.match(/^\/api\/orders\/([^/]+)\/not-ready$/);
    if (method === 'POST' && notReadyMatch) {
      const orderId = notReadyMatch[1];
      const store = readStore();
      const order = store.orders.find((o) => o.id === orderId);

      if (!order) {
        return sendJson(res, 404, { error: 'Pedido não encontrado.' });
      }
      if (order.status !== 'NO_LOCAL_COLETA') {
        return sendJson(res, 409, {
          error: 'O alerta de pedido não pronto só pode ser acionado quando o ciclista já chegou na coleta.',
        });
      }

      order.falseReadyReported = true;
      order.falseReadyReportedAt = new Date().toISOString();
      writeStore(store);
      return sendJson(res, 200, {
        reported: true,
        order,
      });
    }

    const declineOrderMatch = pathname.match(/^\/api\/orders\/([^/]+)\/decline$/);
    if (method === 'POST' && declineOrderMatch) {
      const orderId = declineOrderMatch[1];
      const body = await parseBody(req);
      const courierId = body.courierId || 'bike-andre';
      const store = readStore();
      const order = store.orders.find((o) => o.id === orderId);

      if (!order) {
        return sendJson(res, 404, { error: 'Pedido não encontrado.' });
      }
      if (order.status !== 'AGUARDANDO_CICLISTA') {
        return sendJson(res, 409, {
          error: 'Esta corrida não está mais disponível para recusa.',
        });
      }

      order.declinedByCouriers = Array.isArray(order.declinedByCouriers)
        ? order.declinedByCouriers
        : [];
      if (!order.declinedByCouriers.includes(courierId)) {
        order.declinedByCouriers.push(courierId);
      }

      writeStore(store);
      return sendJson(res, 200, {
        declined: true,
        order,
      });
    }

    const stageMatch = pathname.match(/^\/api\/orders\/([^/]+)\/stage$/);
    if (method === 'POST' && stageMatch) {
      const orderId = stageMatch[1];
      const body = await parseBody(req);
      const nextStage = body.stage;
      const courierId = body.courierId || 'bike-andre';

      const allowedStages = {
        AGUARDANDO_CICLISTA: 'ACEITO_PELO_CICLISTA',
        ACEITO_PELO_CICLISTA: 'NO_LOCAL_COLETA',
        NO_LOCAL_COLETA: 'EM_ROTA_ENTREGA',
        RESGATE_EM_ANDAMENTO: 'EM_ROTA_ENTREGA',
      };

      const store = readStore();
      const courier = store.couriers.find((c) => c.id === courierId);
      if (courier && courier.approved === false) {
        return sendJson(res, 403, { error: 'Cadastro de ciclista aguardando aprovação no Admin.' });
      }

      const order = store.orders.find((o) => o.id === orderId);
      if (!order) {
        return sendJson(res, 404, { error: 'Pedido não encontrado.' });
      }

      let expectedNext = allowedStages[order.status];
      if (order.status === 'INCIDENTE_EM_ROTA' && order.isRescueAvailable) {
        if (order.incident?.firstCourierId === courierId) {
          return sendJson(res, 400, {
            error: 'O ciclista que acionou o SOS não pode aceitar o próprio resgate.',
          });
        }
        expectedNext =
          order.incident?.previousStage === 'EM_ROTA_ENTREGA'
            ? 'RESGATE_EM_ANDAMENTO'
            : 'ACEITO_PELO_CICLISTA';
      }

      if (!expectedNext || (nextStage && nextStage !== expectedNext)) {
        return sendJson(res, 409, {
          error: `Transição inválida a partir de ${order.status} para ${nextStage || 'próxima etapa'}.`,
        });
      }

      if (order.status === 'INCIDENTE_EM_ROTA') {
        order.isRescueAvailable = false;
        if (order.incident) {
          order.incident.rescueCourierId = courierId;
          order.incident.rescueCourierName = courier?.name || body.courierName || courierId;
          order.incident.rescueAcceptedAt = new Date().toISOString();
        }
      }

      order.status = expectedNext;
      order.courierId = courierId;
      order.courierName = courier?.name || body.courierName || courierId;
      order.timestamps = order.timestamps || {};
      const nowIso = new Date().toISOString();

      if (expectedNext === 'ACEITO_PELO_CICLISTA' || expectedNext === 'RESGATE_EM_ANDAMENTO') {
        order.timestamps.acceptedAt = nowIso;
      }
      if (expectedNext === 'NO_LOCAL_COLETA') {
        order.timestamps.arrivedPickupAt = nowIso;
      }
      if (expectedNext === 'EM_ROTA_ENTREGA') {
        order.timestamps.pickedUpAt = nowIso;
        if (order.timestamps.arrivedPickupAt) {
          const arrivedMs = new Date(order.timestamps.arrivedPickupAt).getTime();
          const pickedMs = new Date(nowIso).getTime();
          const measuredWaitMinutes = Math.max(0, (pickedMs - arrivedMs) / 60000);
          const effectiveWaitMinutes = order.falseReadyReported
            ? Number((measuredWaitMinutes + BIKE_RULES.freeWaitMinutes).toFixed(1))
            : Number(measuredWaitMinutes.toFixed(1));
          const previousWait = order.pricing?.ponta1_entregador?.billableWaitMinutes
            ? order.pricing.ponta1_entregador.billableWaitMinutes + BIKE_RULES.freeWaitMinutes
            : 0;
          const finalWaitMinutes = Math.max(previousWait, effectiveWaitMinutes);

          if (finalWaitMinutes > BIKE_RULES.freeWaitMinutes) {
            const updatedPricing = calculateDeliveryPricing({
              distanceKm: Number(order.distanceKm ?? 1.5),
              weightKg: Number(order.weightKg ?? 1.0),
              category: order.category,
              additionalStops: Number(order.additionalStops ?? 0),
              waitMinutes: finalWaitMinutes,
              orderValue: Number(order.pricing?.ponta2_empresa?.orderValue ?? 0),
              isActiveRoute: true,
            });
            if (updatedPricing.approved) {
              order.pricing = updatedPricing;
            }
          }
        }
      }

      writeStore(store);
      return sendJson(res, 200, {
        updated: true,
        order,
      });
    }

    const completeMatch = pathname.match(/^\/api\/orders\/([^/]+)\/complete$/);
    if (method === 'POST' && completeMatch) {
      const orderId = completeMatch[1];
      const body = await parseBody(req);
      const store = readStore();
      const order = store.orders.find((o) => o.id === orderId);

      if (!order) {
        return sendJson(res, 404, { error: 'Pedido não encontrado.' });
      }

      if (order.status === 'CONCLUIDO') {
        return sendJson(res, 409, { error: 'Pedido já foi concluído anteriormente.' });
      }

      if (order.deliveryPin) {
        const providedPin = String(body.deliveryPin || '').replace(/\D/g, '');
        if (providedPin !== String(order.deliveryPin)) {
          return sendJson(res, 400, {
            error: 'Senha de entrega incorreta. Solicite ao cliente os 4 últimos dígitos do CPF.',
          });
        }
      }

      order.status = 'CONCLUIDO';
      order.completedAt = new Date().toISOString();
      order.timestamps = order.timestamps || {};
      order.timestamps.completedAt = order.completedAt;

      // Acumula fundos da Ponta 3
      const p3 = order.pricing.ponta3_bikapp;
      store.funds.opsFund = Number((store.funds.opsFund + p3.opsFund).toFixed(2));
      store.funds.weeklyRankingPool = Number(
        (store.funds.weeklyRankingPool + p3.rankingFundContribution).toFixed(2)
      );
      store.funds.insurancePool = Number(
        (store.funds.insurancePool + p3.insuranceFundContribution).toFixed(2)
      );

      // Atualiza métricas do entregador
      const courierId = body.courierId || order.courierId || 'bike-andre';
      let courier = store.couriers.find((c) => c.id === courierId);
      if (!courier) {
        courier = {
          id: courierId,
          name: body.courierName || `Ciclista ${courierId}`,
          phone: '',
          pixKey: '',
          approved: true,
          city: store.city,
          previousRank: store.couriers.length + 1,
          metrics: {
            completedDeliveries: 0,
            onTimeDeliveries: 0,
            fiveStarRatings: 0,
            peakOrRainDeliveries: 0,
            unjustifiedCancels: 0,
            severeLateDeliveries: 0,
          },
        };
        store.couriers.push(courier);
      }

      order.courierId = courier.id;
      order.courierName = courier.name;

      courier.metrics.completedDeliveries += 1;
      if (body.onTime !== false) courier.metrics.onTimeDeliveries += 1;
      if (body.fiveStar === true) courier.metrics.fiveStarRatings += 1;
      if (body.peakOrRain) courier.metrics.peakOrRainDeliveries += 1;

      writeStore(store);

      return sendJson(res, 200, {
        completed: true,
        order,
        funds: store.funds,
        courier,
      });
    }

    const rateMatch = pathname.match(/^\/api\/orders\/([^/]+)\/rate$/);
    if (method === 'POST' && rateMatch) {
      const orderId = rateMatch[1];
      const body = await parseBody(req);
      const stars = Number(body.stars ?? 5);
      const store = readStore();
      const order = store.orders.find((o) => o.id === orderId);

      if (!order) {
        return sendJson(res, 404, { error: 'Pedido não encontrado.' });
      }
      if (order.status !== 'CONCLUIDO') {
        return sendJson(res, 400, { error: 'Só é possível avaliar pedidos já concluídos.' });
      }
      if (order.customerRating !== null && order.customerRating !== undefined) {
        return sendJson(res, 409, { error: 'Este pedido já foi avaliado pelo cliente.' });
      }

      order.customerRating = Math.min(5, Math.max(1, stars));
      if (order.customerRating === 5 && order.courierId) {
        const courier = store.couriers.find((c) => c.id === order.courierId);
        if (courier) {
          courier.metrics.fiveStarRatings += 1;
        }
      }

      writeStore(store);
      return sendJson(res, 200, { rated: true, order });
    }

    // --- RANKING, FECHAMENTO PIX E BACKUP ---
    if (method === 'GET' && pathname === '/api/ranking') {
      const store = readStore();
      const poolAmount = Number(url.searchParams.get('pool') ?? store.funds.weeklyRankingPool);
      const approvedCouriers = (store.couriers || []).filter((c) => c.approved !== false);
      const ranking = buildWeeklyRanking(approvedCouriers, poolAmount);

      return sendJson(res, 200, {
        city: store.city,
        accumulatedPoolInStore: store.funds.weeklyRankingPool,
        calculatedForPool: poolAmount,
        ranking,
        batches: store.weeklyBatches || [],
      });
    }

    if (method === 'POST' && pathname === '/api/ranking/close-week') {
      const body = await parseBody(req);
      const batch = generateWeeklyPayoutBatch({
        resetPoolAfterClose: body.resetPoolAfterClose !== false,
      });

      return sendJson(res, 200, {
        closed: true,
        batch,
      });
    }

    const payBatchMatch = pathname.match(/^\/api\/ranking\/batches\/([^/]+)\/pay$/);
    if (method === 'POST' && payBatchMatch) {
      const batchId = payBatchMatch[1];
      const batch = markWeeklyBatchPaid(batchId);
      return sendJson(res, 200, { paid: true, batch });
    }

    if (method === 'POST' && pathname === '/api/admin/backup') {
      const backup = backupStore('admin-manual');
      return sendJson(res, 200, { backedUp: true, backup });
    }

    if (method === 'POST' && pathname === '/api/admin/reset-dev') {
      const result = resetDevStore();
      return sendJson(res, 200, {
        reset: true,
        backup: result.backup,
        counts: {
          orders: result.state.orders.length,
          customers: result.state.customers.length,
          merchants: result.state.merchants.length,
          couriers: result.state.couriers.length,
        },
      });
    }

    return sendJson(res, 404, { error: 'Rota não encontrada.' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Erro interno no servidor.' });
  }
}

module.exports = { handleApiRequest };