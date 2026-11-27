const MERCHANT_STORAGE_KEY = 'bikapp_active_merchant_id';

let neighborhoodsMap = {};
let merchantsList = [];
let activeMerchantId = localStorage.getItem(MERCHANT_STORAGE_KEY) || 'merch-farmacia-central';
let lojistaMap = null;
let lojistaLayer = null;

const panelUiState = {
  appSearch: '',
  appStatus: 'ALL',
  appPage: 1,
  appPageSize: 5,
  ownSearch: '',
  ownStatus: 'ALL',
  ownPage: 1,
  ownPageSize: 5,
};

let panelCachedOrders = {
  appOrders: [],
  ownOrders: [],
};

function paginatePanelSlice(items, page, pageSize) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    slice: items.slice(start, start + pageSize),
    safePage,
    totalPages,
    totalItems,
  };
}

function renderPanelPagination(containerId, stateKey, safePage, totalPages, totalItems) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (totalItems === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <span style="font-size: 0.85rem; color: #94a3b8;">
      Página <strong>${safePage}</strong> de <strong>${totalPages}</strong> (${totalItems} pedidos)
    </span>
    <div style="display: flex; gap: 6px;">
      <button type="button" class="btn-secondary" style="padding: 4px 10px; font-size: 0.8rem; ${safePage <= 1 ? 'opacity: 0.45; cursor: not-allowed;' : ''}" ${safePage <= 1 ? 'disabled' : ''} onclick="changePanelPage('${stateKey}', ${safePage - 1})">
        Anterior
      </button>
      <button type="button" class="btn-secondary" style="padding: 4px 10px; font-size: 0.8rem; ${safePage >= totalPages ? 'opacity: 0.45; cursor: not-allowed;' : ''}" ${safePage >= totalPages ? 'disabled' : ''} onclick="changePanelPage('${stateKey}', ${safePage + 1})">
        Próxima
      </button>
    </div>
  `;
}

function changePanelPage(stateKey, targetPage) {
  panelUiState[stateKey] = Math.max(1, targetPage);
  renderFilteredMerchantOrders();
}

function filterOrdersByUi(orders, searchTerm, statusFilter) {
  const term = searchTerm.trim().toLowerCase();
  const closedStatuses = [
    'CONCLUIDO',
    'RECUSADO_PELA_LOJA',
    'CANCELADO_INCIDENTE_REEMBOLSADO',
    'ENCERRADO_POR_INCIDENTE_RECOMPRA',
  ];

  return orders.filter((o) => {
    if (statusFilter === 'PENDING' && o.status !== 'AGUARDANDO_CONFIRMACAO_LOJA') return false;
    if (statusFilter === 'ACTIVE' && closedStatuses.includes(o.status)) return false;
    if (statusFilter === 'DONE' && !closedStatuses.includes(o.status)) return false;
    if (!term) return true;
    const haystack = `${o.id || ''} ${o.customerName || ''} ${o.customerAddress || ''} ${o.itemsSummary || ''}`.toLowerCase();
    return haystack.includes(term);
  });
}

function renderFilteredMerchantOrders() {
  const appContainer = document.getElementById('appOrdersList');
  const ownContainer = document.getElementById('ownOrdersList');

  const sortedAppOrders = [...panelCachedOrders.appOrders].sort((a, b) => {
    const aPend = a.status === 'AGUARDANDO_CONFIRMACAO_LOJA' ? 0 : 1;
    const bPend = b.status === 'AGUARDANDO_CONFIRMACAO_LOJA' ? 0 : 1;
    return aPend - bPend;
  });

  const filteredApp = filterOrdersByUi(sortedAppOrders, panelUiState.appSearch, panelUiState.appStatus);
  const appPageData = paginatePanelSlice(filteredApp, panelUiState.appPage, panelUiState.appPageSize);
  panelUiState.appPage = appPageData.safePage;

  appContainer.innerHTML =
    appPageData.slice.length === 0
      ? '<p>Nenhum pedido encontrado neste filtro.</p>'
      : appPageData.slice.map(renderOrderCard).join('');

  renderPanelPagination(
    'appOrdersPagination',
    'appPage',
    appPageData.safePage,
    appPageData.totalPages,
    appPageData.totalItems
  );

  const filteredOwn = filterOrdersByUi(panelCachedOrders.ownOrders, panelUiState.ownSearch, panelUiState.ownStatus);
  const ownPageData = paginatePanelSlice(filteredOwn, panelUiState.ownPage, panelUiState.ownPageSize);
  panelUiState.ownPage = ownPageData.safePage;

  ownContainer.innerHTML =
    ownPageData.slice.length === 0
      ? '<p>Nenhum pedido próprio encontrado neste filtro.</p>'
      : ownPageData.slice.map(renderOrderCard).join('');

  renderPanelPagination(
    'ownOrdersPagination',
    'ownPage',
    ownPageData.safePage,
    ownPageData.totalPages,
    ownPageData.totalItems
  );
}

function formatBRL(val) {
  return Number(val || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatStageLabel(status) {
  const labels = {
    AGUARDANDO_CONFIRMACAO_LOJA: 'Etapa 0/4: Confirmar Estoque e Iniciar Preparo',
    EM_PREPARO_NA_LOJA: 'Preparando na Loja (Ciclista ainda não acionado)',
    RECUSADO_PELA_LOJA: 'Recusado pela Loja (Sem Estoque)',
    AGUARDANDO_CICLISTA: 'Etapa 1/4: Pedido Pronto no Balcão • Chamando Ciclista',
    ACEITO_PELO_CICLISTA: 'Etapa 2/4: Ciclista a Caminho da Loja',
    NO_LOCAL_COLETA: 'Etapa 3/4: Ciclista na Loja (Conferir Senha de Coleta)',
    INCIDENTE_EM_ROTA: 'Incidente em Rota • Suporte / Resgate Acionado',
    RESGATE_EM_ANDAMENTO: 'Ciclista de Resgate Coletando Pacote',
    EM_ROTA_ENTREGA: 'Etapa 4/4: Ciclista em Rota para o Cliente',
    CONCLUIDO: 'Concluído (Entregue ao Cliente)',
    CANCELADO_INCIDENTE_REEMBOLSADO: 'Cancelado por Incidente em Rota (Estorno Cliente)',
    ENCERRADO_POR_INCIDENTE_RECOMPRA: 'Encerrado por Incidente • Recompra Segurada Gerada',
  };
  return labels[status] || status;
}

document.querySelectorAll('.m-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.m-tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.m-tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    const targetId = btn.dataset.mtab;
    document.getElementById(targetId).classList.add('active');

    if (targetId === 'tabLiveTracking') {
      setTimeout(() => {
        initAndUpdateLojistaMap();
        if (lojistaMap) {
          lojistaMap.invalidateSize();
        }
      }, 100);
    }
  });
});

function fillMerchantForm(merchant) {
  if (!merchant) {
    document.getElementById('mName').value = '';
    document.getElementById('mDoc').value = '';
    document.getElementById('mCategory').value = 'FARMACIA_LEVE';
    document.getElementById('mNeighborhood').value = 'CENTRO';
    document.getElementById('mAddress').value = '';
    document.getElementById('activeMerchantHeader').textContent = 'Novo Cadastro';
    document.getElementById('kpiMerchantStatus').textContent = 'NOVO';
    return;
  }

  document.getElementById('mName').value = merchant.name || '';
  document.getElementById('mDoc').value = merchant.cnpjOrCpf || '';
  document.getElementById('mCategory').value = merchant.category || 'FARMACIA_LEVE';
  document.getElementById('mNeighborhood').value = merchant.neighborhood || 'CENTRO';
  document.getElementById('mAddress').value = merchant.address || '';
  document.getElementById('prodCategory').value = merchant.category || 'FARMACIA_LEVE';
  document.getElementById('ownCategory').value = merchant.category || 'FARMACIA_LEVE';

  document.getElementById('activeMerchantHeader').textContent = merchant.name;
  const statusEl = document.getElementById('kpiMerchantStatus');
  if (merchant.approved !== false) {
    statusEl.textContent = 'APROVADO';
    statusEl.className = 'status-pill-ok';
  } else {
    statusEl.textContent = 'PENDENTE ADMIN';
    statusEl.className = 'status-pill-warn';
  }
}

function renderMerchantSelector() {
  const sel = document.getElementById('merchantSelector');
  const options = merchantsList.map(
    (m) =>
      `<option value="${m.id}" ${m.id === activeMerchantId ? 'selected' : ''}>${m.name} (${m.approved !== false ? 'Aprovado' : 'Aguardando Aprovação'
      })</option>`
  );
  options.push('<option value="__NEW__">+ Cadastrar Novo Estabelecimento</option>');
  sel.innerHTML = options.join('');

  const current = merchantsList.find((m) => m.id === activeMerchantId);
  if (current) {
    fillMerchantForm(current);
  } else if (merchantsList.length > 0 && activeMerchantId !== '__NEW__') {
    activeMerchantId = merchantsList[0].id;
    localStorage.setItem(MERCHANT_STORAGE_KEY, activeMerchantId);
    sel.value = activeMerchantId;
    fillMerchantForm(merchantsList[0]);
  } else {
    fillMerchantForm(null);
  }
}

async function loadMerchantProducts() {
  const container = document.getElementById('merchantProductsList');
  if (!activeMerchantId || activeMerchantId === '__NEW__') {
    container.innerHTML = '<p>Salve o cadastro da empresa acima para gerenciar produtos.</p>';
    return;
  }

  const res = await fetch(`/api/products?merchantId=${encodeURIComponent(activeMerchantId)}`);
  const data = await res.json();
  const products = data.products || [];

  if (products.length === 0) {
    container.innerHTML = '<p>Nenhum produto leve cadastrado para este estabelecimento ainda.</p>';
    return;
  }

  container.innerHTML = products
    .map(
      (p) => `
      <div class="order-item">
        <div class="order-meta">
          <strong>${p.name}</strong> (${p.weightKg} kg)<br/>
          Preço: <strong>${formatBRL(p.priceBRL)}</strong> | Status:
          <span class="badge ${p.active !== false ? 'done' : 'wait'}">${p.active !== false ? 'ATIVO NO APP' : 'PAUSADO'
        }</span>
        </div>
        <div>
          <button type="button" class="btn-secondary" onclick="toggleProduct('${p.id}')">
            ${p.active !== false ? 'Pausar' : 'Ativar'}
          </button>
        </div>
      </div>
    `
    )
    .join('');
}

async function toggleProduct(productId) {
  const res = await fetch(`/api/products/${productId}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.ok) {
    await loadMerchantProducts();
  }
}

async function confirmStoreOrder(orderId) {
  const res = await fetch(`/api/orders/${orderId}/confirm-store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Erro ao iniciar preparo na loja.');
    return;
  }
  await loadMerchantOrders();
  initAndUpdateLojistaMap();
}

async function readyPickupOrder(orderId) {
  const res = await fetch(`/api/orders/${orderId}/ready-pickup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Erro ao marcar pedido como pronto.');
    return;
  }
  await loadMerchantOrders();
  initAndUpdateLojistaMap();
}

async function rejectStoreOrder(orderId) {
  const res = await fetch(`/api/orders/${orderId}/reject-store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Produto indisponível no estoque no momento.' }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Erro ao recusar pedido.');
    return;
  }
  await loadMerchantOrders();
  initAndUpdateLojistaMap();
}

function renderOrderCard(o) {
  const p1 = o.pricing.ponta1_entregador;
  const p2 = o.pricing.ponta2_empresa;
  const isDone = o.status === 'CONCLUIDO';
  const needsConfirmation = o.status === 'AGUARDANDO_CONFIRMACAO_LOJA';
  const isPreparing = o.status === 'EM_PREPARO_NA_LOJA';
  const ratingText =
    o.customerRating !== null && o.customerRating !== undefined
      ? ` | Avaliação Cliente: <strong>${o.customerRating}/5 estrelas</strong>`
      : '';

  const pickupCodeBadge = o.pickupCode
    ? ` | Senha Coleta Ciclista: <strong style="color:#38bdf8; font-size:0.95rem;">${o.pickupCode}</strong>`
    : '';
  const falseReadyAlert = o.falseReadyReported
    ? `<div style="margin-top:6px; color:#fca5a5; font-size:0.83rem;"><strong>Alerta de Atraso na Coleta:</strong> Ciclista reportou que o pedido não estava pronto no balcão (carência de 5 min cancelada).</div>`
    : '';

  let storeActionsHtml = '';
  if (needsConfirmation) {
    storeActionsHtml = `<div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
         <button type="button" class="btn-primary" onclick="confirmStoreOrder('${o.id}')">
           1. Confirmar Estoque e Iniciar Preparo
         </button>
         <button type="button" class="btn-secondary" style="background: #991b1b; color: #fecaca;" onclick="rejectStoreOrder('${o.id}')">
           Recusar (Sem Estoque)
         </button>
       </div>`;
  } else if (isPreparing) {
    storeActionsHtml = `<div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
         <button type="button" class="btn-primary" style="background:#0284c7;" onclick="readyPickupOrder('${o.id}')">
           2. Pedido Pronto no Balcão — Chamar Ciclista
         </button>
         <button type="button" class="btn-secondary" style="background: #991b1b; color: #fecaca;" onclick="rejectStoreOrder('${o.id}')">
           Cancelar Antes do Chamado
         </button>
       </div>`;
  }

  return `
    <div class="order-item" style="${needsConfirmation || isPreparing ? 'border: 1px solid #f59e0b;' : ''}">
      <div class="order-meta">
        <strong>Pedido ${o.id}</strong> — Cliente: <strong>${o.customerName || 'Cliente'}</strong> (${o.customerAddress || ''})<br/>
        Itens: ${o.itemsSummary || o.category} (${o.distanceKm || '-'} km • ${o.weightKg || '-'} kg)<br/>
        Ciclista: <strong>${o.courierName || (needsConfirmation || isPreparing ? 'Aguardando pedido ficar pronto no balcão' : 'Aguardando aceite')}</strong> | Repasse Ciclista: <strong>${formatBRL(p1.totalPayout)}</strong> | Custo Logístico Loja: <strong>${formatBRL(p2.totalCost)}</strong>${pickupCodeBadge}<br/>
        Andamento: <span class="badge ${isDone ? 'done' : 'wait'}">${formatStageLabel(o.status)}</span>${ratingText}
        ${falseReadyAlert}
        ${storeActionsHtml}
      </div>
    </div>
  `;
}

async function loadMerchantOrders() {
  const appContainer = document.getElementById('appOrdersList');
  const ownContainer = document.getElementById('ownOrdersList');
  const telemetryContainer = document.getElementById('liveTelemetryList');

  if (!activeMerchantId || activeMerchantId === '__NEW__') {
    appContainer.innerHTML = '<p>Selecione ou cadastre um estabelecimento.</p>';
    ownContainer.innerHTML = '<p>Selecione ou cadastre um estabelecimento.</p>';
    telemetryContainer.innerHTML = '<p>Selecione ou cadastre um estabelecimento.</p>';
    return;
  }

  const res = await fetch(`/api/orders?merchantId=${encodeURIComponent(activeMerchantId)}`);
  const data = await res.json();
  const allOrders = data.orders || [];

  const appOrders = allOrders.filter(
    (o) => o.originChannel === 'APP_CLIENTE' || o.originChannel === 'RECOMPRA_SEGURADA'
  );
  const ownOrders = allOrders.filter(
    (o) => o.originChannel !== 'APP_CLIENTE' && o.originChannel !== 'RECOMPRA_SEGURADA'
  );
  const activeOrders = allOrders.filter(
    (o) =>
      ![
        'CONCLUIDO',
        'RECUSADO_PELA_LOJA',
        'CANCELADO_INCIDENTE_REEMBOLSADO',
        'ENCERRADO_POR_INCIDENTE_RECOMPRA',
      ].includes(o.status)
  );

  document.getElementById('kpiAppOrders').textContent = appOrders.length;
  document.getElementById('kpiOwnOrders').textContent = ownOrders.length;

  panelCachedOrders = {
    appOrders,
    ownOrders,
  };

  renderFilteredMerchantOrders();

  if (activeOrders.length === 0) {
    telemetryContainer.innerHTML = '<p>Nenhuma entrega ativa em andamento para este estabelecimento no momento.</p>';
  } else {
    telemetryContainer.innerHTML = activeOrders
      .map((o) => {
        let waitInfo =
          o.status === 'AGUARDANDO_CONFIRMACAO_LOJA'
            ? 'Aguardando loja confirmar estoque e iniciar embalo (ciclista ainda não acionado)'
            : 'Aguardando chegada do ciclista na loja';
        if (o.timestamps?.arrivedPickupAt && !o.timestamps?.pickedUpAt) {
          const mins = Math.max(
            0,
            (Date.now() - new Date(o.timestamps.arrivedPickupAt).getTime()) / 60000
          ).toFixed(1);
          waitInfo = `Ciclista aguardando retirada há ${mins} min (5 min grátis; após isso +R$ 0,30/min)`;
        } else if (o.timestamps?.pickedUpAt) {
          waitInfo = `Pedido retirado às ${new Date(o.timestamps.pickedUpAt).toLocaleTimeString('pt-BR')}`;
        }

        return `
          <div class="order-item">
            <div class="order-meta">
              <strong>${o.id}</strong> (${o.originChannel === 'APP_CLIENTE' ? 'App Cliente' : 'Balcão Loja'}) — Destino: <strong>${o.customerName}</strong><br/>
              Etapa Atual: <span class="badge wait">${formatStageLabel(o.status)}</span> | Ciclista: <strong>${o.courierName || 'Buscando...'}</strong><br/>
              Telemetria de Coleta: ${waitInfo}
            </div>
          </div>
        `;
      })
      .join('');
  }
}

function initAndUpdateLojistaMap() {
  if (!window.L) return;
  const activeMerchant = merchantsList.find((m) => m.id === activeMerchantId);
  const centerLat = activeMerchant?.lat || -25.5478;
  const centerLng = activeMerchant?.lng || -54.5882;

  if (!lojistaMap) {
    lojistaMap = L.map('lojistaMap').setView([centerLat, centerLng], 14);
    const sat = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '&copy; Esri Satélite' }
    );
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    });
    sat.addTo(lojistaMap);
    L.control.layers({ 'Satélite': sat, 'Mapa Urbano': osm }).addTo(lojistaMap);
    lojistaLayer = L.layerGroup().addTo(lojistaMap);
  }

  fetch('/api/location')
    .then((r) => r.json())
    .then((snap) => {
      if (!lojistaLayer) return;
      lojistaLayer.clearLayers();

      if (activeMerchant && activeMerchant.lat && activeMerchant.lng) {
        L.marker([activeMerchant.lat, activeMerchant.lng])
          .bindPopup(`Minha Loja: <strong>${activeMerchant.name}</strong>`)
          .addTo(lojistaLayer);
      }

      (snap.couriers || []).forEach((c) => {
        L.circleMarker([c.lat, c.lng], {
          radius: 8,
          color: '#22c55e',
          fillColor: '#4ade80',
          fillOpacity: 0.9,
        })
          .bindPopup(`Ciclista Ativo: <strong>${c.name}</strong>`)
          .addTo(lojistaLayer);
      });

      (snap.orders || [])
        .filter(
          (o) =>
            o.status !== 'CONCLUIDO' &&
            o.status !== 'RECUSADO_PELA_LOJA' &&
            (!o.merchantId || o.merchantId === activeMerchantId)
        )
        .forEach((o) => {
          if (o.dropoffCoords) {
            L.circleMarker([o.dropoffCoords.lat, o.dropoffCoords.lng], {
              radius: 7,
              color: '#38bdf8',
              fillColor: '#0284c7',
              fillOpacity: 0.9,
            })
              .bindPopup(`Entrega Cliente: <strong>${o.customerName}</strong> (${o.status})`)
              .addTo(lojistaLayer);
          }
        });
    });
}

async function bootstrapMerchantPanel() {
  const [healthRes, merchRes] = await Promise.all([
    fetch('/health'),
    fetch('/api/merchants'),
  ]);
  const health = await healthRes.json();
  const merchData = await merchRes.json();

  document.getElementById('cityLabel').textContent = health.city || 'Foz do Iguaçu';
  neighborhoodsMap = health.neighborhoods || {};

  const nbOptionsHtml = Object.entries(neighborhoodsMap)
    .map(([code, info]) => `<option value="${code}">${info.label}</option>`)
    .join('');

  document.getElementById('mNeighborhood').innerHTML = nbOptionsHtml;
  document.getElementById('ownDropoffNeighborhood').innerHTML = nbOptionsHtml;

  merchantsList = merchData.merchants || [];
  renderMerchantSelector();

  await Promise.all([loadMerchantProducts(), loadMerchantOrders()]);
  initAndUpdateLojistaMap();
}

document.getElementById('merchantSelector').addEventListener('change', async (e) => {
  activeMerchantId = e.target.value;
  if (activeMerchantId === '__NEW__') {
    fillMerchantForm(null);
    await Promise.all([loadMerchantProducts(), loadMerchantOrders()]);
    return;
  }
  localStorage.setItem(MERCHANT_STORAGE_KEY, activeMerchantId);
  const found = merchantsList.find((m) => m.id === activeMerchantId);
  fillMerchantForm(found);
  await Promise.all([loadMerchantProducts(), loadMerchantOrders()]);
  initAndUpdateLojistaMap();
});

document.getElementById('merchantForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const isCreatingNew = activeMerchantId === '__NEW__';
  const payload = {
    id: isCreatingNew ? undefined : activeMerchantId,
    name: document.getElementById('mName').value,
    cnpjOrCpf: document.getElementById('mDoc').value,
    category: document.getElementById('mCategory').value,
    neighborhood: document.getElementById('mNeighborhood').value,
    address: document.getElementById('mAddress').value,
  };

  const res = await fetch('/api/merchants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await res.json();
  const fb = document.getElementById('merchantFeedback');
  fb.classList.remove('hidden', 'ok', 'err');

  if (!res.ok) {
    fb.classList.add('err');
    fb.textContent = result.error || 'Erro ao salvar empresa.';
    return;
  }

  activeMerchantId = result.merchant.id;
  localStorage.setItem(MERCHANT_STORAGE_KEY, activeMerchantId);
  fb.classList.add('ok');
  fb.innerHTML = `Empresa <strong>${result.merchant.name}</strong> salva com sucesso!`;

  const merchRes = await fetch('/api/merchants');
  const merchData = await merchRes.json();
  merchantsList = merchData.merchants || [];
  renderMerchantSelector();
  await Promise.all([loadMerchantProducts(), loadMerchantOrders()]);
});

document.getElementById('productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fb = document.getElementById('productFeedback');
  fb.classList.remove('hidden', 'ok', 'err');

  if (!activeMerchantId || activeMerchantId === '__NEW__') {
    fb.classList.add('err');
    fb.textContent = 'Salve o cadastro da empresa antes de cadastrar produtos.';
    return;
  }

  const payload = {
    merchantId: activeMerchantId,
    name: document.getElementById('prodName').value,
    category: document.getElementById('prodCategory').value,
    weightKg: Number(document.getElementById('prodWeight').value),
    priceBRL: Number(document.getElementById('prodPrice').value),
    active: true,
  };

  const res = await fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await res.json();

  if (!res.ok) {
    fb.classList.add('err');
    fb.textContent = result.error || 'Erro ao cadastrar produto.';
    return;
  }

  fb.classList.add('ok');
  fb.innerHTML = `Produto <strong>${result.product.name}</strong> adicionado ao catálogo!`;
  document.getElementById('prodName').value = '';
  await loadMerchantProducts();
});

document.getElementById('ownOrderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const feedback = document.getElementById('ownOrderFeedback');
  feedback.classList.remove('hidden', 'ok', 'err');

  if (!activeMerchantId || activeMerchantId === '__NEW__') {
    feedback.classList.add('err');
    feedback.textContent = 'Salve o cadastro da empresa antes de solicitar entrega.';
    return;
  }

  const rawDistance = document.getElementById('ownDistanceKm').value;
  const payload = {
    originChannel: 'BALCAO_LOJISTA',
    merchantId: activeMerchantId,
    customerName: document.getElementById('ownCustName').value,
    dropoffNeighborhood: document.getElementById('ownDropoffNeighborhood').value,
    customerAddress: document.getElementById('ownCustAddress').value,
    category: document.getElementById('ownCategory').value,
    itemsSummary: document.getElementById('ownItems').value,
    distanceKm: rawDistance !== '' ? Number(rawDistance) : undefined,
    weightKg: Number(document.getElementById('ownWeightKg').value),
    additionalStops: Number(document.getElementById('ownAdditionalStops').value),
    waitMinutes: Number(document.getElementById('ownWaitMinutes').value),
    orderValue: Number(document.getElementById('ownOrderValue').value),
  };

  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await res.json();

  if (!res.ok) {
    feedback.classList.add('err');
    const errList = result.pricing?.validation?.errors?.join('<br/>') || result.message || 'Pedido bloqueado.';
    feedback.innerHTML = `<strong>Bloqueado pelo Filtro Modal Bike:</strong><br/>${errList}`;
    return;
  }

  const p1 = result.order.pricing.ponta1_entregador;
  const p2 = result.order.pricing.ponta2_empresa;
  const p3 = result.order.pricing.ponta3_bikapp;

  feedback.classList.add('ok');
  feedback.innerHTML = `
    <strong>Entrega Própria Solicitada com Sucesso!</strong><br/>
    Distância calculada: <strong>${result.order.distanceKm} km</strong><br/>
    Repasse Ciclista (Ponta 1): <strong>${formatBRL(p1.totalPayout)}</strong> | Taxa Plataforma (Ponta 3): <strong>${formatBRL(p3.totalFee)}</strong><br/>
    Custo Total para a Loja: <strong>${formatBRL(p2.totalCost)}</strong> (0% comissão sobre produto)
  `;

  await loadMerchantOrders();
  initAndUpdateLojistaMap();
});

const appSearchEl = document.getElementById('appOrdersSearchInput');
if (appSearchEl) {
  appSearchEl.addEventListener('input', (e) => {
    panelUiState.appSearch = e.target.value;
    panelUiState.appPage = 1;
    renderFilteredMerchantOrders();
  });
}

const appStatusEl = document.getElementById('appOrdersStatusFilter');
if (appStatusEl) {
  appStatusEl.addEventListener('change', (e) => {
    panelUiState.appStatus = e.target.value;
    panelUiState.appPage = 1;
    renderFilteredMerchantOrders();
  });
}

const ownSearchEl = document.getElementById('ownOrdersSearchInput');
if (ownSearchEl) {
  ownSearchEl.addEventListener('input', (e) => {
    panelUiState.ownSearch = e.target.value;
    panelUiState.ownPage = 1;
    renderFilteredMerchantOrders();
  });
}

const ownStatusEl = document.getElementById('ownOrdersStatusFilter');
if (ownStatusEl) {
  ownStatusEl.addEventListener('change', (e) => {
    panelUiState.ownStatus = e.target.value;
    panelUiState.ownPage = 1;
    renderFilteredMerchantOrders();
  });
}

bootstrapMerchantPanel();
setInterval(() => {
  loadMerchantOrders();
  initAndUpdateLojistaMap();
}, 5000);