let adminMap = null;
let adminLayer = null;

const adminUiState = {
  sosStatus: 'ABERTO',
  sosPage: 1,
  sosPageSize: 3,
  couriersSearch: '',
  couriersStatus: 'ALL',
  couriersPage: 1,
  couriersPageSize: 8,
  customersSearch: '',
  customersPage: 1,
  customersPageSize: 8,
  rankingPage: 1,
  rankingPageSize: 10,
};

let adminCachedData = {
  alerts: [],
  couriers: [],
  customers: [],
  leaderboard: [],
};

function paginateSlice(items, page, pageSize) {
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

function renderPaginationControls(containerId, stateKey, safePage, totalPages, totalItems, itemLabel) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (totalItems === 0) {
    container.innerHTML = `<span style="font-size: 0.85rem; color: #94a3b8;">Nenhum ${itemLabel} encontrado.</span>`;
    return;
  }

  container.innerHTML = `
    <span style="font-size: 0.85rem; color: #94a3b8;">
      Página <strong>${safePage}</strong> de <strong>${totalPages}</strong> (${totalItems} ${itemLabel})
    </span>
    <div style="display: flex; gap: 6px;">
      <button type="button" class="btn-gold" style="padding: 4px 10px; font-size: 0.8rem; ${safePage <= 1 ? 'opacity: 0.45; cursor: not-allowed;' : ''}" ${safePage <= 1 ? 'disabled' : ''} onclick="changeAdminPage('${stateKey}', ${safePage - 1})">
        Anterior
      </button>
      <button type="button" class="btn-gold" style="padding: 4px 10px; font-size: 0.8rem; ${safePage >= totalPages ? 'opacity: 0.45; cursor: not-allowed;' : ''}" ${safePage >= totalPages ? 'disabled' : ''} onclick="changeAdminPage('${stateKey}', ${safePage + 1})">
        Próxima
      </button>
    </div>
  `;
}

function changeAdminPage(stateKey, targetPage) {
  adminUiState[stateKey] = Math.max(1, targetPage);
  renderAllAdminLists();
}

function setAdminSosFilter(status) {
  adminUiState.sosStatus = status;
  adminUiState.sosPage = 1;
  renderAdminSosAlerts(adminCachedData.alerts);
}

function renderAllAdminLists() {
  renderAdminSosAlerts(adminCachedData.alerts);
  renderAdminCouriersTable();
  renderAdminCustomersTable();
  renderAdminRankingTable();
}

function brl(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function renderBatchBox(batches) {
  const box = document.getElementById('payoutBatchBox');
  if (!batches || batches.length === 0) {
    box.innerHTML = 'Nenhum fechamento semanal executado ainda.';
    return;
  }

  const latest = batches[0];
  const batchStatus =
    latest.status ||
    (latest.paidAt
      ? 'PAGO_VIA_PIX'
      : Number(latest.totalAllocated || 0) > 0
        ? 'AGUARDANDO_PIX'
        : 'SEM_SALDO');
  const isPaid = batchStatus === 'PAGO_VIA_PIX';
  const lines = (latest.payouts || [])
    .map(
      (p) =>
        `#${p.rank} <strong>${p.courierName}</strong> | Pix: <code>${p.pixKey || 'PENDENTE'}</code> | ${p.points} pts -> <strong>${brl(p.amountBRL)}</strong> (${p.status || 'PENDENTE_LIQUIDACAO'})`
    )
    .join('<br/>');

  const payButtonHtml =
    !isPaid && latest.totalAllocated > 0
      ? `<div style="margin-top: 12px;">
           <button type="button" class="btn-gold" onclick="confirmBatchPaid('${latest.batchId}')">
             Confirmar Pagamento Pix do Lote (${brl(latest.totalAllocated)})
           </button>
         </div>`
      : '';

  box.innerHTML = `
    <strong>Último Lote:</strong> ${latest.batchId} | <strong>Status:</strong> ${batchStatus}<br/>
    <strong>Fundo Avaliado:</strong> ${brl(latest.poolBeforeClose)} | <strong>Total Alocado (Top 20):</strong> ${brl(latest.totalAllocated)} | <strong>Saldo Remanescente:</strong> ${brl(latest.unallocatedRemainder || 0)}<br/>
    <strong>Reserva de Seguro no Fechamento:</strong> ${brl(latest.insuranceReserveSnapshot)}<br/><br/>
    ${lines || 'Sem valores acumulados no fundo para distribuir neste fechamento.'}
    ${payButtonHtml}
  `;
}

async function loadAdminDashboard() {
  const [healthRes, rankingRes, merchRes, courRes, custRes, sosRes] = await Promise.all([
    fetch('/health'),
    fetch('/api/ranking'),
    fetch('/api/merchants'),
    fetch('/api/couriers'),
    fetch('/api/customers'),
    fetch('/api/sos'),
  ]);

  const health = await healthRes.json();
  const rankingData = await rankingRes.json();
  const merchData = await merchRes.json();
  const courData = await courRes.json();
  const custData = await custRes.json();
  const sosData = await sosRes.json();

  document.getElementById('adminCity').textContent = health.city || 'Foz do Iguaçu';
  document.getElementById('admOps').textContent = brl(health.funds.opsFund);
  document.getElementById('admRankingPool').textContent = brl(health.funds.weeklyRankingPool);
  document.getElementById('admInsurance').textContent = brl(health.funds.insurancePool);

  const counts = health.counts || {};
  document.getElementById('admOrdersCount').textContent = `${counts.orders ?? 0} ped | ${counts.merchants ?? 0} loj | ${counts.couriers ?? 0} bike | ${counts.customers ?? 0} cli`;

  adminCachedData = {
    alerts: sosData.alerts || [],
    couriers: courData.couriers || [],
    customers: custData.customers || [],
    leaderboard: rankingData.ranking?.visibleLeaderboard || [],
  };

  renderBatchBox(rankingData.batches || []);

  // Estabelecimentos
  const merchBody = document.getElementById('adminMerchantsBody');
  merchBody.innerHTML = (merchData.merchants || [])
    .map(
      (m) => `
      <tr>
        <td><strong>${m.name}</strong></td>
        <td>${m.cnpjOrCpf || '-'}</td>
        <td>${m.category}</td>
        <td>${m.address} (${m.neighborhood})</td>
        <td><strong>${m.approved !== false ? 'APROVADO' : 'SUSPENSO'}</strong></td>
        <td>
          <button type="button" class="btn-gold" style="padding: 4px 10px; font-size: 0.8rem;" onclick="toggleMerchantApproval('${m.id}', ${m.approved === false})">
            ${m.approved !== false ? 'Suspender' : 'Aprovar'}
          </button>
        </td>
      </tr>
    `
    )
    .join('');

  renderAllAdminLists();
}

function renderAdminCouriersTable() {
  const term = adminUiState.couriersSearch.trim().toLowerCase();
  const statusFilter = adminUiState.couriersStatus;

  const filtered = adminCachedData.couriers.filter((c) => {
    const isApproved = c.approved !== false;
    if (statusFilter === 'APROVADO' && !isApproved) return false;
    if (statusFilter === 'SUSPENSO' && isApproved) return false;
    if (!term) return true;
    const haystack = `${c.name || ''} ${c.phone || ''} ${c.pixKey || ''}`.toLowerCase();
    return haystack.includes(term);
  });

  const { slice, safePage, totalPages, totalItems } = paginateSlice(
    filtered,
    adminUiState.couriersPage,
    adminUiState.couriersPageSize
  );
  adminUiState.couriersPage = safePage;

  const courBody = document.getElementById('adminCouriersBody');
  courBody.innerHTML = slice
    .map(
      (c) => `
      <tr>
        <td><strong>${c.name}</strong></td>
        <td>${c.phone || '-'}</td>
        <td><code>${c.pixKey || 'Não cadastrada'}</code></td>
        <td>${c.metrics?.completedDeliveries ?? 0}</td>
        <td><strong>${c.approved !== false ? 'APROVADO' : 'SUSPENSO'}</strong> (${c.online !== false ? 'ONLINE' : 'OFFLINE'})</td>
        <td>
          <button type="button" class="btn-gold" style="padding: 4px 10px; font-size: 0.8rem;" onclick="toggleCourierApproval('${c.id}', ${c.approved === false})">
            ${c.approved !== false ? 'Suspender' : 'Aprovar'}
          </button>
        </td>
      </tr>
    `
    )
    .join('');

  renderPaginationControls(
    'couriersPagination',
    'couriersPage',
    safePage,
    totalPages,
    totalItems,
    'ciclistas'
  );
}

function renderAdminCustomersTable() {
  const term = adminUiState.customersSearch.trim().toLowerCase();
  const filtered = adminCachedData.customers.filter((c) => {
    if (!term) return true;
    const haystack = `${c.name || ''} ${c.phone || ''} ${c.neighborhood || ''} ${c.address || ''}`.toLowerCase();
    return haystack.includes(term);
  });

  const { slice, safePage, totalPages, totalItems } = paginateSlice(
    filtered,
    adminUiState.customersPage,
    adminUiState.customersPageSize
  );
  adminUiState.customersPage = safePage;

  const custBody = document.getElementById('adminCustomersBody');
  custBody.innerHTML = slice
    .map(
      (c) => `
      <tr>
        <td><strong>${c.name}</strong></td>
        <td>${c.phone || '-'}</td>
        <td>${c.neighborhood || '-'}</td>
        <td>${c.address || '-'}</td>
      </tr>
    `
    )
    .join('');

  renderPaginationControls(
    'customersPagination',
    'customersPage',
    safePage,
    totalPages,
    totalItems,
    'clientes'
  );
}

function renderAdminRankingTable() {
  const { slice, safePage, totalPages, totalItems } = paginateSlice(
    adminCachedData.leaderboard,
    adminUiState.rankingPage,
    adminUiState.rankingPageSize
  );
  adminUiState.rankingPage = safePage;

  const tbody = document.getElementById('adminRankingBody');
  tbody.innerHTML = slice
    .map(
      (item) => `
      <tr>
        <td><strong>#${item.rank}</strong></td>
        <td>${item.name}</td>
        <td>${item.completedDeliveries}</td>
        <td>${item.points} pts</td>
        <td><strong>${brl(item.prizeAmount)}</strong></td>
      </tr>
    `
    )
    .join('');

  renderPaginationControls(
    'rankingPagination',
    'rankingPage',
    safePage,
    totalPages,
    totalItems,
    'ranqueados'
  );
}

function renderAdminSosAlerts(alerts) {
  const batchBox = document.getElementById('payoutBatchBox');
  if (!batchBox) return;

  let sosContainer = document.getElementById('adminSosAlertBox');
  if (!sosContainer) {
    sosContainer = document.createElement('div');
    sosContainer.id = 'adminSosAlertBox';
    batchBox.parentNode.insertBefore(sosContainer, batchBox);
  }

  if (!alerts || alerts.length === 0) {
    sosContainer.innerHTML = '';
    return;
  }

  const openCount = alerts.filter((a) => a.status === 'ABERTO').length;
  const resolvedCount = alerts.filter((a) => a.status !== 'ABERTO').length;

  const filteredAlerts = alerts.filter((a) => {
    if (adminUiState.sosStatus === 'ABERTO') return a.status === 'ABERTO';
    if (adminUiState.sosStatus === 'ATENDIDO') return a.status !== 'ABERTO';
    return true;
  });

  const { slice, safePage, totalPages, totalItems } = paginateSlice(
    filteredAlerts,
    adminUiState.sosPage,
    adminUiState.sosPageSize
  );
  adminUiState.sosPage = safePage;

  const filterBar = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px; padding:8px 10px; background:#0f172a; border:1px solid #334155; border-radius:8px;">
      <span style="font-size:0.85rem; color:#cbd5e1;"><strong>Protocolos SOS:</strong> ${openCount} abertos | ${resolvedCount} atendidos</span>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button type="button" class="btn-gold" style="padding:4px 8px; font-size:0.75rem; ${adminUiState.sosStatus === 'ABERTO' ? '' : 'opacity:0.6;'}" onclick="setAdminSosFilter('ABERTO')">Abertos (${openCount})</button>
        <button type="button" class="btn-gold" style="padding:4px 8px; font-size:0.75rem; ${adminUiState.sosStatus === 'ATENDIDO' ? '' : 'opacity:0.6;'}" onclick="setAdminSosFilter('ATENDIDO')">Atendidos (${resolvedCount})</button>
        <button type="button" class="btn-gold" style="padding:4px 8px; font-size:0.75rem; ${adminUiState.sosStatus === 'TODOS' ? '' : 'opacity:0.6;'}" onclick="setAdminSosFilter('TODOS')">Todos (${alerts.length})</button>
      </div>
    </div>
  `;

  const cardsHtml =
    slice.length === 0
      ? '<div style="font-size:0.85rem; color:#94a3b8; margin-bottom:10px;">Nenhum protocolo SOS neste filtro.</div>'
      : slice
        .map((a) => {
          const isOpen = a.status === 'ABERTO';
          return `
              <div style="background:${isOpen ? '#450a0a' : '#0f172a'}; border:1px solid ${isOpen ? '#ef4444' : '#334155'}; border-radius:10px; padding:12px; margin-bottom:10px; color:${isOpen ? '#fee2e2' : '#cbd5e1'};">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                  <strong>${isOpen ? 'ALERTA SOS EM ROTA' : 'SOS ATENDIDO'} (${a.id}) — ${a.courierName}</strong>
                  ${isOpen
              ? `<button type="button" class="btn-gold" style="padding:5px 10px; font-size:0.8rem;" onclick="resolveSosAlert('${a.id}')">Marcar SOS como Atendido</button>`
              : '<span style="font-size:0.75rem; color:#34d399; font-weight:700;">RESOLVIDO</span>'
            }
                </div>
                <div style="font-size:0.85rem; margin-top:6px;">
                  Motivo: <strong>${a.reason}</strong> | Carga: <strong>${a.cargoCondition}</strong> | Tel: <strong>${a.courierPhone || '-'}</strong><br/>
                  Corrida: <strong>${a.activeOrderSummary}</strong> | GPS: <code>${Number(a.lat).toFixed(5)}, ${Number(a.lng).toFixed(5)}</code> | Fundo Seguro: <strong>${brl(a.insurancePoolSnapshot)}</strong>
                </div>
              </div>
            `;
        })
        .join('');

  sosContainer.innerHTML = `${filterBar}${cardsHtml}<div id="sosPagination" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;"></div>`;
  renderPaginationControls('sosPagination', 'sosPage', safePage, totalPages, totalItems, 'alertas SOS');
}

async function resolveSosAlert(sosId) {
  const res = await fetch(`/api/sos/${sosId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.ok) {
    const fb = document.getElementById('adminActionFeedback');
    if (fb) fb.textContent = `Chamado SOS ${sosId} marcado como ATENDIDO.`;
    await loadAdminDashboard();
  }
}

async function toggleMerchantApproval(merchantId, nextApproved) {
  const res = await fetch(`/api/merchants/${merchantId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved: nextApproved }),
  });
  if (res.ok) {
    await loadAdminDashboard();
  }
}

async function toggleCourierApproval(courierId, nextApproved) {
  const res = await fetch(`/api/couriers/${courierId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved: nextApproved }),
  });
  if (res.ok) {
    await loadAdminDashboard();
  }
}

async function confirmBatchPaid(batchId) {
  const res = await fetch(`/api/ranking/batches/${batchId}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  const fb = document.getElementById('adminActionFeedback');
  if (!res.ok) {
    fb.textContent = data.error || 'Erro ao confirmar pagamento Pix.';
    return;
  }
  fb.textContent = `Lote ${batchId} confirmado como PAGO VIA PIX!`;
  await loadAdminDashboard();
}

document.getElementById('closeWeekBtn').addEventListener('click', async () => {
  const res = await fetch('/api/ranking/close-week', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resetPoolAfterClose: true }),
  });
  const data = await res.json();
  const fb = document.getElementById('adminActionFeedback');

  if (!res.ok) {
    fb.textContent = data.error || 'Erro ao fechar ranking semanal.';
    return;
  }

  fb.textContent = `Fechamento semanal concluído (Lote ${data.batch.batchId}). Saldo do fundo abatido automaticamente.`;
  await loadAdminDashboard();
});

document.getElementById('backupBtn').addEventListener('click', async () => {
  const res = await fetch('/api/admin/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  const fb = document.getElementById('adminActionFeedback');
  if (res.ok) {
    fb.textContent = `Backup de segurança criado: ${data.backup.fileName}`;
  }
});

document.getElementById('resetDevBtn').addEventListener('click', async () => {
  const confirmed = window.confirm(
    'Deseja limpar pedidos, fundos, lotes Pix, clientes de teste e zerar a pontuação do ranking? Um backup automático será salvo antes da limpeza.'
  );
  if (!confirmed) return;

  const res = await fetch('/api/admin/reset-dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  const fb = document.getElementById('adminActionFeedback');

  if (!res.ok) {
    fb.textContent = data.error || 'Erro ao limpar dados de teste.';
    return;
  }

  localStorage.removeItem('bikapp_active_customer_id');
  fb.textContent = `Ambiente limpo com sucesso! Backup salvo em: ${data.backup.fileName}`;
  await loadAdminDashboard();
  updateAdminMap();
});

function updateAdminMap() {
  if (!window.L) return;
  if (!adminMap) {
    adminMap = L.map('adminMap').setView([-25.5478, -54.5882], 13);
    const sat = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '&copy; Esri Satélite' }
    );
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    });
    sat.addTo(adminMap);
    L.control.layers({ 'Satélite': sat, 'Mapa Urbano': osm }).addTo(adminMap);
    adminLayer = L.layerGroup().addTo(adminMap);
  }

  fetch('/api/location')
    .then((r) => r.json())
    .then((snap) => {
      if (!adminLayer) return;
      adminLayer.clearLayers();

      (snap.couriers || []).forEach((c) => {
        L.circleMarker([c.lat, c.lng], {
          radius: 9,
          color: '#38bdf8',
          fillColor: '#0ea5e9',
          fillOpacity: 0.9,
        })
          .bindPopup(`Ciclista Ativo: <strong>${c.name}</strong>`)
          .addTo(adminLayer);
      });

      (snap.orders || [])
        .filter((o) => o.status !== 'CONCLUIDO')
        .forEach((o) => {
          if (o.pickupCoords) {
            L.marker([o.pickupCoords.lat, o.pickupCoords.lng])
              .bindPopup(`Coleta: <strong>${o.merchantName}</strong> (${o.status})`)
              .addTo(adminLayer);
          }
          if (o.dropoffCoords) {
            L.circleMarker([o.dropoffCoords.lat, o.dropoffCoords.lng], {
              radius: 7,
              color: '#f59e0b',
              fillColor: '#fbbf24',
              fillOpacity: 0.9,
            })
              .bindPopup(`Destino: <strong>${o.customerName}</strong>`)
              .addTo(adminLayer);
          }
        });
    });
}

const courierSearchEl = document.getElementById('courierSearchInput');
if (courierSearchEl) {
  courierSearchEl.addEventListener('input', (e) => {
    adminUiState.couriersSearch = e.target.value;
    adminUiState.couriersPage = 1;
    renderAdminCouriersTable();
  });
}

const courierStatusEl = document.getElementById('courierStatusFilter');
if (courierStatusEl) {
  courierStatusEl.addEventListener('change', (e) => {
    adminUiState.couriersStatus = e.target.value;
    adminUiState.couriersPage = 1;
    renderAdminCouriersTable();
  });
}

const customerSearchEl = document.getElementById('customerSearchInput');
if (customerSearchEl) {
  customerSearchEl.addEventListener('input', (e) => {
    adminUiState.customersSearch = e.target.value;
    adminUiState.customersPage = 1;
    renderAdminCustomersTable();
  });
}

loadAdminDashboard();
updateAdminMap();
setInterval(() => {
  loadAdminDashboard();
  updateAdminMap();
}, 5000);