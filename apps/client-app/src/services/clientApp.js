const STORAGE_KEY = 'bikapp_active_customer_id';

let clientMap;
let clientMarkers;
let neighborhoodsMap = {};
let customersList = [];
let merchantsList = [];
let currentProducts = [];
let activeCustomerId = localStorage.getItem(STORAGE_KEY) || '__NEW__';

function formatBRL(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function estimateDistanceKm(origin, dest) {
  if (!origin || !dest) return 1.8;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(Number(dest.lat) - Number(origin.lat));
  const dLng = toRad(Number(dest.lng) - Number(origin.lng));
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(Number(origin.lat))) *
    Math.cos(toRad(Number(dest.lat))) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number(Math.max(0.8, R * c * 1.28).toFixed(2));
}

function getStageLabel(status) {
  const map = {
    AGUARDANDO_CONFIRMACAO_LOJA: '0/4 Aguardando Loja Confirmar Estoque e Embalo',
    RECUSADO_PELA_LOJA: 'Pedido Recusado pela Loja (Item Indisponível)',
    AGUARDANDO_CICLISTA: '1/4 Estoque Confirmado • Aguardando Ciclista Aceitar',
    ACEITO_PELO_CICLISTA: '2/4 Ciclista a Caminho da Loja',
    NO_LOCAL_COLETA: '3/4 Ciclista Retirando na Loja',
    INCIDENTE_EM_ROTA: 'Imprevisto em Rota • Seguro BikApp Ativado',
    RESGATE_EM_ANDAMENTO: 'Ciclista de Resgate Indo Coletar seu Pedido',
    EM_ROTA_ENTREGA: '4/4 Em Rota de Entrega para Você',
    CONCLUIDO: 'Entregue com Sucesso',
    CANCELADO_INCIDENTE_REEMBOLSADO: 'Cancelado por Incidente • Reembolso 100% Garantido',
    ENCERRADO_POR_INCIDENTE_RECOMPRA: 'Substituído por Novo Pedido Segurado',
  };
  return map[status] || status;
}

function initClientMap() {
  if (!window.L || clientMap) return;
  clientMap = L.map('clientMap').setView([-25.5478, -54.5882], 14);
  const sat = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: '&copy; Esri Satélite' }
  );
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
  });
  sat.addTo(clientMap);
  L.control.layers({ 'Satélite': sat, 'Mapa Urbano': osm }).addTo(clientMap);
  clientMarkers = L.layerGroup().addTo(clientMap);
}

function renderClientMap(snapshot, myOrders) {
  if (!clientMap || !clientMarkers) return;
  clientMarkers.clearLayers();

  const activeCust = customersList.find((c) => c.id === activeCustomerId);
  if (activeCust && activeCust.lat && activeCust.lng) {
    L.circleMarker([activeCust.lat, activeCust.lng], {
      radius: 8,
      color: '#38bdf8',
      fillColor: '#0284c7',
      fillOpacity: 0.9,
    })
      .bindPopup(`Meu Endereço: <strong>${activeCust.name}</strong>`)
      .addTo(clientMarkers);
  }

  (snapshot.couriers || []).forEach((c) => {
    L.circleMarker([c.lat, c.lng], {
      radius: 8,
      color: '#10b981',
      fillColor: '#34d399',
      fillOpacity: 0.9,
    })
      .bindPopup(`Ciclista: <strong>${c.name}</strong>`)
      .addTo(clientMarkers);
  });

  (myOrders || [])
    .filter(
      (o) =>
        o.status !== 'CONCLUIDO' &&
        o.status !== 'RECUSADO_PELA_LOJA' &&
        o.pickupCoords
    )
    .forEach((o) => {
      L.marker([o.pickupCoords.lat, o.pickupCoords.lng])
        .bindPopup(`Coleta do seu pedido: <strong>${o.merchantName}</strong>`)
        .addTo(clientMarkers);
    });
}

function fillCustomerForm(customer) {
  if (!customer) {
    document.getElementById('custName').value = '';
    document.getElementById('custPhone').value = '';
    document.getElementById('custAddress').value = '';
    document.getElementById('custNeighborhood').value = 'CENTRO';
    return;
  }
  document.getElementById('custName').value = customer.name || '';
  document.getElementById('custPhone').value = customer.phone || '';
  document.getElementById('custAddress').value = customer.address || '';
  document.getElementById('custNeighborhood').value = customer.neighborhood || 'CENTRO';
}

function renderCustomerSelector() {
  const sel = document.getElementById('customerSelector');
  const options = [
    `<option value="__NEW__" ${activeCustomerId === '__NEW__' ? 'selected' : ''}>+ Cadastrar Novo Cliente (Obrigatório antes do 1º pedido)</option>`,
    ...customersList.map(
      (c) => `<option value="${c.id}" ${c.id === activeCustomerId ? 'selected' : ''}>${c.name} — ${c.address}</option>`
    ),
  ];
  sel.innerHTML = options.join('');

  const found = customersList.find((c) => c.id === activeCustomerId);
  if (found) {
    fillCustomerForm(found);
  } else {
    activeCustomerId = '__NEW__';
    localStorage.removeItem(STORAGE_KEY);
    sel.value = '__NEW__';
    fillCustomerForm(null);
  }
}

function updateQuotePreview() {
  const preview = document.getElementById('orderQuotePreview');
  const submitBtn = document.getElementById('submitClientOrderBtn');
  const checkedBoxes = Array.from(document.querySelectorAll('.prod-check:checked'));

  const merchantId = document.getElementById('clientMerchant').value;
  const merchant = merchantsList.find((m) => m.id === merchantId);
  const customer = customersList.find((c) => c.id === activeCustomerId);

  if (!customer || activeCustomerId === '__NEW__') {
    preview.innerHTML =
      '<span style="color:#fbbf24;"><strong>Cadastro Obrigatório:</strong> Preencha e salve seus dados na Seção 1 acima antes de realizar seu pedido.</span>';
    submitBtn.disabled = true;
    return;
  }

  if (!merchant) {
    preview.innerHTML = 'Escolha um estabelecimento parceiro aprovado.';
    submitBtn.disabled = true;
    return;
  }

  const distanceKm = estimateDistanceKm(
    { lat: merchant.lat, lng: merchant.lng },
    { lat: customer.lat, lng: customer.lng }
  );

  if (checkedBoxes.length === 0) {
    preview.innerHTML = `Distância Bike Estimada: <strong>${distanceKm} km</strong> (Limite: 4,5 km) • Marque ao menos 1 produto acima.`;
    submitBtn.disabled = true;
    return;
  }

  let totalItemsValue = 0;
  let totalWeightKg = 0;
  checkedBoxes.forEach((cb) => {
    const prod = currentProducts.find((p) => p.id === cb.value);
    if (prod) {
      totalItemsValue += Number(prod.priceBRL || 0);
      totalWeightKg += Number(prod.weightKg || 0);
    }
  });

  totalWeightKg = Number(totalWeightKg.toFixed(2));
  const extraKm = Math.max(0, distanceKm - 1.5);
  const estimatedDeliveryFee = Number((8.0 + extraKm * 1.6 + 1.8).toFixed(2));

  const distanceBlocked = distanceKm > 4.5;
  const weightBlocked = totalWeightKg > 8.0;

  if (distanceBlocked || weightBlocked) {
    submitBtn.disabled = true;
    preview.innerHTML = `
      <span style="color:#f87171;">
        <strong>Fora do limite do Modal Bike:</strong>
        ${distanceBlocked ? `Distância (${distanceKm} km) acima de 4,5 km. ` : ''}
        ${weightBlocked ? `Peso (${totalWeightKg} kg) acima de 8,0 kg.` : ''}
      </span>
    `;
    return;
  }

  submitBtn.disabled = false;
  preview.innerHTML = `
    Distância Bike: <strong>${distanceKm} km</strong> | Peso Total: <strong>${totalWeightKg} kg</strong><br/>
    Produtos: <strong>${formatBRL(totalItemsValue)}</strong> + Entrega Ecológica Bike: <strong>${formatBRL(estimatedDeliveryFee)}</strong><br/>
    Total Estimado: <strong>${formatBRL(totalItemsValue + estimatedDeliveryFee)}</strong> (Seguro em rota incluso)
  `;
}

async function loadProductsForMerchant(merchantId) {
  const checklist = document.getElementById('productChecklist');
  if (!merchantId) {
    checklist.innerHTML = 'Nenhum estabelecimento selecionado.';
    return;
  }
  const res = await fetch(`/api/products?merchantId=${encodeURIComponent(merchantId)}`);
  const data = await res.json();
  currentProducts = (data.products || []).filter((p) => p.active !== false);

  if (currentProducts.length === 0) {
    checklist.innerHTML = '<span style="color:#94a3b8;">Esta loja ainda não possui produtos leves ativos.</span>';
    updateQuotePreview();
    return;
  }

  checklist.innerHTML = currentProducts
    .map(
      (p, idx) => `
      <label style="display:flex; align-items:center; justify-content:space-between; gap:8px; cursor:pointer; padding:4px 0; border-bottom:1px solid #1e293b;">
        <span>
          <input type="checkbox" class="prod-check" value="${p.id}" ${idx === 0 ? 'checked' : ''} />
          ${p.name} <small style="color:#94a3b8;">(${p.weightKg} kg)</small>
        </span>
        <strong>${formatBRL(p.priceBRL)}</strong>
      </label>
    `
    )
    .join('');

  document.querySelectorAll('.prod-check').forEach((cb) => {
    cb.addEventListener('change', updateQuotePreview);
  });
  updateQuotePreview();
}

async function loadClientOrdersAndMap() {
  initClientMap();

  if (!activeCustomerId || activeCustomerId === '__NEW__') {
    const mapRes = await fetch('/api/location');
    const mapSnap = await mapRes.json();
    renderClientMap(mapSnap, []);
    document.getElementById('clientOrdersList').innerHTML =
      '<p style="color:#94a3b8;">Conclua seu cadastro acima para fazer e acompanhar seus pedidos.</p>';
    return;
  }

  const [ordersRes, mapRes] = await Promise.all([
    fetch(`/api/orders?customerId=${encodeURIComponent(activeCustomerId)}`),
    fetch('/api/location'),
  ]);
  const data = await ordersRes.json();
  const mapSnap = await mapRes.json();

  const orders = data.orders || [];
  renderClientMap(mapSnap, orders);

  const completedCount = orders.filter((o) => o.status === 'CONCLUIDO').length;
  const co2Kg = (completedCount * 0.35).toFixed(2).replace('.', ',');
  document.getElementById('co2SavedLabel').textContent = `${co2Kg} kg`;

  const container = document.getElementById('clientOrdersList');
  if (orders.length === 0) {
    container.innerHTML = '<p style="color:#94a3b8;">Você ainda não possui pedidos nesta conta.</p>';
    return;
  }

  container.innerHTML = orders
    .map((o) => {
      const deliveryFee = Number(
        (o.pricing.ponta1_entregador.totalPayout + o.pricing.ponta3_bikapp.totalFee).toFixed(2)
      );
      const itemsVal = Number(o.pricing.ponta2_empresa.orderValue || 0);
      const isDone = o.status === 'CONCLUIDO';
      const ratingHtml =
        isDone && (o.customerRating === null || o.customerRating === undefined)
          ? `<div style="margin-top:8px;">
               <span style="font-size:0.82rem; color:#fbbf24;">Avalie a entrega do ciclista:</span>
               <button type="button" class="btn-eco" style="padding:4px 10px; font-size:0.8rem; margin-left:6px;" onclick="rateOrder('${o.id}', 5)">5 Estrelas (Excelente)</button>
               <button type="button" class="btn-eco" style="padding:4px 10px; font-size:0.8rem; background:#334155;" onclick="rateOrder('${o.id}', 4)">4 Estrelas</button>
             </div>`
          : isDone && o.customerRating
            ? `<div style="margin-top:6px; font-size:0.82rem; color:#34d399;">Avaliação enviada: ${o.customerRating}/5 estrelas</div>`
            : '';

      const isRejected =
        o.status === 'RECUSADO_PELA_LOJA' || o.status === 'CANCELADO_INCIDENTE_REEMBOLSADO';
      const isIncident =
        o.status === 'INCIDENTE_EM_ROTA' || o.status === 'RESGATE_EM_ANDAMENTO';
      const statusColor = isRejected ? '#f87171' : isIncident ? '#fbbf24' : '#34d399';
      const rejectionLine =
        o.status === 'RECUSADO_PELA_LOJA'
          ? `<div style="color:#fca5a5; margin-top:4px;">Motivo: <strong>${o.rejectionReason || 'Item indisponível no estoque.'}</strong></div>`
          : '';

      let incidentPanelHtml = '';
      if (o.incident && (isIncident || o.status === 'CANCELADO_INCIDENTE_REEMBOLSADO' || o.status === 'ENCERRADO_POR_INCIDENTE_RECOMPRA')) {
        const canRescue = o.incident.cargoCondition === 'INTACTA';
        const choiceMade = o.incident.clientChoice;

        const choiceButtonsHtml =
          !choiceMade && o.status === 'INCIDENTE_EM_ROTA'
            ? `<div style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">
                ${canRescue ? `<button type="button" class="btn-eco" style="background:#0284c7;" onclick="chooseIncidentOption('${o.id}', 'AGUARDAR_RESGATE')">1. Aguardar Entregador de Resgate (+R$ 5,00 cortesia)</button>` : ''}
                <button type="button" class="btn-eco" style="background:#16a34a;" onclick="chooseIncidentOption('${o.id}', 'RECOMPRA_SEGURADA')">2. Refazer Mesmo Pedido na Loja (Sem Custo • Ideal para Lanches)</button>
                <button type="button" class="btn-eco" style="background:#b91c1c;" onclick="chooseIncidentOption('${o.id}', 'CANCELAR_REEMBOLSO')">3. Cancelar Pedido e Receber 100% de Reembolso</button>
              </div>`
            : choiceMade
              ? `<div style="margin-top:6px; color:#86efac;">
                Decisão registrada: <strong>${choiceMade}</strong>
                ${o.incident.courtesyCreditBRL > 0 ? ` • Crédito cortesia aplicado: <strong>${formatBRL(o.incident.courtesyCreditBRL)}</strong>` : ''}
                ${o.incident.refundedAmountBRL > 0 ? ` • Estorno integral garantido: <strong>${formatBRL(o.incident.refundedAmountBRL)}</strong>` : ''}
                ${o.incident.replacementOrderId ? ` • Novo pedido segurado: <strong>${o.incident.replacementOrderId}</strong>` : ''}
              </div>`
              : '';

        incidentPanelHtml = `
          <div style="margin-top:8px; padding:10px; border-radius:8px; background:#451a03; border:1px solid #f59e0b; color:#fef3c7;">
            <strong>Aviso de Contingência em Rota:</strong> O ciclista ${o.incident.firstCourierName} reportou <strong>${o.incident.reason}</strong> (Carga: <strong>${o.incident.cargoCondition}</strong>). Sua compra está 100% protegida pelo Seguro BikApp.
            ${choiceButtonsHtml}
          </div>
        `;
      }

      return `
        <div class="client-order-card" style="${isIncident ? 'border: 1px solid #f59e0b;' : ''}">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <strong>${o.merchantName}</strong>
            <span style="color:${statusColor}; font-weight:bold; font-size:0.85rem;">${getStageLabel(o.status)}</span>
          </div>
          <div style="margin-top:4px; font-size:0.88rem;">
            Itens: ${o.itemsSummary || o.category}<br/>
            Ciclista: <strong>${o.courierName || (o.status === 'AGUARDANDO_CONFIRMACAO_LOJA' ? 'Aguardando confirmação da loja' : 'Aguardando aceite')}</strong> | Distância: <strong>${o.distanceKm || '-'} km</strong><br/>
            Produtos: <strong>${formatBRL(itemsVal)}</strong> | Entrega Bike: <strong>${formatBRL(deliveryFee)}</strong> | Seguro em rota: <strong>ATIVO</strong>
            ${rejectionLine}
            ${incidentPanelHtml}
          </div>
          ${ratingHtml}
        </div>
      `;
    })
    .join('');
}

async function rateOrder(orderId, stars) {
  const res = await fetch(`/api/orders/${orderId}/rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stars }),
  });
  if (res.ok) {
    await loadClientOrdersAndMap();
  }
}

async function chooseIncidentOption(orderId, choice) {
  const res = await fetch(`/api/orders/${orderId}/incident-choice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ choice }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Não foi possível registrar sua escolha.');
    return;
  }
  await loadClientOrdersAndMap();
}

async function bootstrapClientApp() {
  const [healthRes, custRes, merchRes] = await Promise.all([
    fetch('/health'),
    fetch('/api/customers'),
    fetch('/api/merchants'),
  ]);
  const health = await healthRes.json();
  const custData = await custRes.json();
  const merchData = await merchRes.json();

  document.getElementById('clientCity').textContent = `${health.city || 'Foz do Iguaçu'} • Modal Bicicleta`;

  neighborhoodsMap = health.neighborhoods || {};
  const nbSelect = document.getElementById('custNeighborhood');
  nbSelect.innerHTML = Object.entries(neighborhoodsMap)
    .map(([code, info]) => `<option value="${code}">${info.label}</option>`)
    .join('');

  customersList = custData.customers || [];
  renderCustomerSelector();

  merchantsList = (merchData.merchants || []).filter((m) => m.approved !== false);
  const merchSelect = document.getElementById('clientMerchant');
  merchSelect.innerHTML = merchantsList
    .map((m) => `<option value="${m.id}">${m.name} (${m.address})</option>`)
    .join('');

  if (merchantsList.length > 0) {
    await loadProductsForMerchant(merchantsList[0].id);
  }

  await loadClientOrdersAndMap();
}

document.getElementById('customerSelector').addEventListener('change', async (e) => {
  activeCustomerId = e.target.value;
  if (activeCustomerId === '__NEW__') {
    fillCustomerForm(null);
    updateQuotePreview();
    await loadClientOrdersAndMap();
    return;
  }
  localStorage.setItem(STORAGE_KEY, activeCustomerId);
  const found = customersList.find((c) => c.id === activeCustomerId);
  fillCustomerForm(found);
  updateQuotePreview();
  await loadClientOrdersAndMap();
});

document.getElementById('customerProfileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const isCreatingNew = activeCustomerId === '__NEW__';
  const payload = {
    id: isCreatingNew ? undefined : activeCustomerId,
    name: document.getElementById('custName').value,
    phone: document.getElementById('custPhone').value,
    neighborhood: document.getElementById('custNeighborhood').value,
    address: document.getElementById('custAddress').value,
  };

  const res = await fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await res.json();
  const fb = document.getElementById('customerProfileFeedback');
  fb.classList.remove('hidden');

  if (!res.ok) {
    fb.textContent = result.error || 'Erro ao salvar cadastro.';
    return;
  }

  activeCustomerId = result.customer.id;
  localStorage.setItem(STORAGE_KEY, activeCustomerId);
  fb.innerHTML = `Cadastro de <strong>${result.customer.name}</strong> salvo com sucesso!`;

  const custRes = await fetch('/api/customers');
  const custData = await custRes.json();
  customersList = custData.customers || [];
  renderCustomerSelector();
  updateQuotePreview();
  await loadClientOrdersAndMap();
});

document.getElementById('clientMerchant').addEventListener('change', async (e) => {
  await loadProductsForMerchant(e.target.value);
});

document.getElementById('clientOrderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = document.getElementById('clientFeedback');
  box.classList.remove('hidden');

  if (!activeCustomerId || activeCustomerId === '__NEW__') {
    box.textContent = 'Por favor, salve seu cadastro na seção 1 antes de enviar o pedido.';
    return;
  }

  const merchantId = document.getElementById('clientMerchant').value;
  const merchant = merchantsList.find((m) => m.id === merchantId);
  const checkedBoxes = Array.from(document.querySelectorAll('.prod-check:checked'));

  if (!merchant || checkedBoxes.length === 0) {
    box.textContent = 'Selecione uma loja e pelo menos um produto leve.';
    return;
  }

  const selectedItems = checkedBoxes
    .map((cb) => currentProducts.find((p) => p.id === cb.value))
    .filter(Boolean);

  const itemsSummary = selectedItems.map((p) => `1x ${p.name}`).join(' + ');
  const weightKg = Number(
    selectedItems.reduce((acc, p) => acc + Number(p.weightKg || 0), 0).toFixed(2)
  );
  const orderValue = Number(
    selectedItems.reduce((acc, p) => acc + Number(p.priceBRL || 0), 0).toFixed(2)
  );

  const payload = {
    originChannel: 'APP_CLIENTE',
    customerId: activeCustomerId,
    merchantId: merchant.id,
    category: selectedItems[0].category || merchant.category || 'FARMACIA_LEVE',
    itemsSummary,
    weightKg,
    orderValue,
  };

  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await res.json();

  if (!res.ok) {
    const errText = result.pricing?.validation?.errors?.join(' ') || result.message || 'Pedido rejeitado.';
    box.textContent = `Pedido não aceito para bike: ${errText}`;
    return;
  }

  box.innerHTML = `Pedido <strong>${result.order.id}</strong> enviado para <strong>${merchant.name}</strong>! Acompanhe abaixo as 4 etapas da entrega.`;
  await loadClientOrdersAndMap();
});

bootstrapClientApp();
setInterval(loadClientOrdersAndMap, 5000);