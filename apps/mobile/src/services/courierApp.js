const COURIER_STORAGE_KEY = 'bikapp_active_courier_id';

let activeCourierId = localStorage.getItem(COURIER_STORAGE_KEY) || 'bike-andre';
let couriersList = [];
let cachedOrdersList = [];
let cachedBatchesList = [];
let latestMapSnapshot = null;
let mapInstance = null;
let markersLayer = null;
let openMapPopupKey = null;
let autoGpsWatchId = null;
let isCourierFormDirty = false;
let hasHydratedCourierForm = false;
let hideFinanceValues = false;
let financePeriodFilter = '7D';

function getFirstName(fullName) {
  const clean = String(fullName || 'Cliente').trim();
  return clean.split(/\s+/)[0] || 'Cliente';
}

function formatStreetAndNeighborhood(streetAddress, neighborhoodLabel) {
  const street = String(streetAddress || '').trim();
  const nb = String(neighborhoodLabel || '').trim();
  if (street && nb) return `${street} — ${nb}`;
  return street || nb || 'Foz do Iguaçu';
}

function brl(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getStageActionConfig(order) {
  const status = order.status;
  if (status === 'INCIDENTE_EM_ROTA' && order.isRescueAvailable) {
    const nextStage =
      order.incident?.previousStage === 'EM_ROTA_ENTREGA'
        ? 'RESGATE_EM_ANDAMENTO'
        : 'ACEITO_PELO_CICLISTA';
    return {
      label: 'Aceitar Resgate Prioritário (2x + Tempo)',
      nextStage,
      isComplete: false,
    };
  }
  switch (status) {
    case 'AGUARDANDO_CICLISTA':
      return {
        label: 'Etapa 1: Aceitar Corrida',
        nextStage: 'ACEITO_PELO_CICLISTA',
        isComplete: false,
      };
    case 'ACEITO_PELO_CICLISTA':
      return {
        label: 'Etapa 2: Cheguei na Coleta',
        nextStage: 'NO_LOCAL_COLETA',
        isComplete: false,
      };
    case 'NO_LOCAL_COLETA':
      return {
        label: 'Etapa 3: Sai para Entrega',
        nextStage: 'EM_ROTA_ENTREGA',
        isComplete: false,
      };
    case 'RESGATE_EM_ANDAMENTO':
      return {
        label: 'Pacote Resgatado • Seguir para Cliente',
        nextStage: 'EM_ROTA_ENTREGA',
        isComplete: false,
      };
    case 'EM_ROTA_ENTREGA':
      return {
        label: 'Etapa 4: Concluir Entrega',
        nextStage: 'CONCLUIDO',
        isComplete: true,
      };
    default:
      return null;
  }
}

function formatStageHuman(status) {
  const labels = {
    AGUARDANDO_CICLISTA: '1/4 Disponível para Aceite',
    ACEITO_PELO_CICLISTA: '2/4 Indo para Coleta na Loja',
    NO_LOCAL_COLETA: '3/4 No Local de Coleta (Aguardando Pedido)',
    INCIDENTE_EM_ROTA: 'RESGATE PRIORITÁRIO • Incidente em Rota',
    RESGATE_EM_ANDAMENTO: '2/4 Em Deslocamento para Transbordo do Pacote',
    EM_ROTA_ENTREGA: '4/4 Em Rota de Entrega ao Cliente',
    CONCLUIDO: 'Concluído',
  };
  return labels[status] || status;
}

function initCourierMap() {
  if (!window.L || mapInstance) return;
  mapInstance = L.map('courierMap').setView([-25.5478, -54.5882], 14);

  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
  });

  const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: '&copy; Esri Satélite' }
  );

  satelliteLayer.addTo(mapInstance);
  L.control.layers({ 'Satélite': satelliteLayer, 'Mapa Urbano': streetLayer }).addTo(mapInstance);
  markersLayer = L.layerGroup().addTo(mapInstance);
}

function attachPersistentPopup(layer, popupKey, htmlContent) {
  layer.bindPopup(htmlContent, {
    closeButton: true,
    autoClose: true,
    closeOnClick: false,
    maxWidth: 270,
  });

  layer.on('popupopen', () => {
    openMapPopupKey = popupKey;
  });

  layer.on('popupclose', () => {
    if (openMapPopupKey === popupKey) {
      openMapPopupKey = null;
    }
  });

  layer.addTo(markersLayer);

  if (openMapPopupKey === popupKey) {
    layer.openPopup();
  }
}

function renderMapMarkers(snapshot) {
  if (!mapInstance || !markersLayer) return;
  const previousPopupKey = openMapPopupKey;
  markersLayer.clearLayers();
  openMapPopupKey = previousPopupKey;

  (snapshot.couriers || []).forEach((c) => {
    const marker = L.circleMarker([c.lat, c.lng], {
      radius: 8,
      color: '#22c55e',
      fillColor: '#4ade80',
      fillOpacity: 0.9,
    });
    attachPersistentPopup(
      marker,
      `courier-${c.courierId}`,
      `<strong>${c.name}</strong><br/>Posição GPS ativa (Precisão: ${c.accuracy ? `${Math.round(c.accuracy)}m` : 'OK'})`
    );
  });

  const activeProfileForMap = couriersList.find((c) => c.id === activeCourierId);
  const isCourierOnlineForMap = activeProfileForMap ? activeProfileForMap.online !== false : true;

  (snapshot.orders || [])
    .filter((o) => {
      const isMineActive =
        o.courierId === activeCourierId &&
        o.status !== 'CONCLUIDO' &&
        o.status !== 'RECUSADO_PELA_LOJA';
      const isDeclinedByMe =
        Array.isArray(o.declinedByCouriers) && o.declinedByCouriers.includes(activeCourierId);
      const isOpenForMe =
        isCourierOnlineForMap && o.status === 'AGUARDANDO_CICLISTA' && !isDeclinedByMe;
      return isMineActive || isOpenForMe;
    })
    .forEach((o) => {
      const clientFirstName = getFirstName(o.customerName);
      const pickupFull = formatStreetAndNeighborhood(o.pickupAddress, o.pickupNeighborhood);
      const dropoffFull = formatStreetAndNeighborhood(o.dropoffAddress, o.dropoffNeighborhood);
      const codeLine = o.pickupCode ? `<span>Senha Coleta: <strong>${o.pickupCode}</strong></span><br/>` : '';

      if (o.pickupCoords) {
        const gmapsPickup = `https://www.google.com/maps/dir/?api=1&destination=${o.pickupCoords.lat},${o.pickupCoords.lng}&travelmode=bicycling`;
        const pickupHtml = `
          <div style="font-size:0.82rem; line-height:1.4; color:#0f172a;">
            <strong>Coleta: ${o.merchantName}</strong><br/>
            <span>Local: ${pickupFull}</span><br/>
            ${codeLine}
            <hr style="margin:4px 0; border:none; border-top:1px solid #cbd5e1;"/>
            <span>Cliente: <strong>${clientFirstName}</strong></span><br/>
            <span>Entrega: ${dropoffFull}</span><br/>
            <span>Ganho: <strong>${brl(o.payoutBRL)}</strong> (${o.distanceKm || '-'} km • ${o.weightKg || '-'} kg)</span><br/>
            <a href="${gmapsPickup}" target="_blank" rel="noopener" style="display:inline-block; margin-top:5px; color:#0284c7; font-weight:700; text-decoration:underline;">Abrir Rota Coleta no GPS</a>
          </div>
        `;
        const pickupMarker = L.marker([o.pickupCoords.lat, o.pickupCoords.lng]);
        attachPersistentPopup(pickupMarker, `pickup-${o.id}`, pickupHtml);
      }

      if (o.dropoffCoords) {
        const gmapsDropoff = `https://www.google.com/maps/dir/?api=1&destination=${o.dropoffCoords.lat},${o.dropoffCoords.lng}&travelmode=bicycling`;
        const dropoffHtml = `
          <div style="font-size:0.82rem; line-height:1.4; color:#0f172a;">
            <strong>Entrega: ${clientFirstName}</strong><br/>
            <span>Endereço: ${dropoffFull}</span><br/>
            <span>Ganho: <strong>${brl(o.payoutBRL)}</strong></span><br/>
            <a href="${gmapsDropoff}" target="_blank" rel="noopener" style="display:inline-block; margin-top:5px; color:#0284c7; font-weight:700; text-decoration:underline;">Abrir Rota Cliente no GPS</a>
          </div>
        `;
        const dropoffMarker = L.circleMarker([o.dropoffCoords.lat, o.dropoffCoords.lng], {
          radius: 7,
          color: '#38bdf8',
          fillColor: '#0284c7',
          fillOpacity: 0.9,
        });
        attachPersistentPopup(dropoffMarker, `dropoff-${o.id}`, dropoffHtml);
      }
    });
}

function fillCourierForm(courier) {
  if (!courier) {
    document.getElementById('cName').value = '';
    document.getElementById('cPhone').value = '';
    document.getElementById('cPixKey').value = '';
    return;
  }
  document.getElementById('cName').value = courier.name || '';
  document.getElementById('cPhone').value = courier.phone || '';
  document.getElementById('cPixKey').value = courier.pixKey || '';
}

function renderCourierSelector(syncForm = false) {
  const sel = document.getElementById('courierSelector');
  const options = couriersList.map(
    (c) =>
      `<option value="${c.id}" ${c.id === activeCourierId ? 'selected' : ''}>${c.name} (${c.approved !== false ? 'Aprovado' : 'Aguardando Admin'
      })</option>`
  );
  options.push('<option value="__NEW__">+ Cadastrar Novo Ciclista</option>');
  sel.innerHTML = options.join('');

  const profileForm = document.getElementById('courierProfileForm');
  const isEditingNow = isCourierFormDirty || (profileForm && profileForm.contains(document.activeElement));

  const current = couriersList.find((c) => c.id === activeCourierId);
  if (current) {
    if (syncForm && !isEditingNow) {
      fillCourierForm(current);
      hasHydratedCourierForm = true;
    }
  } else if (couriersList.length > 0 && activeCourierId !== '__NEW__') {
    activeCourierId = couriersList[0].id;
    localStorage.setItem(COURIER_STORAGE_KEY, activeCourierId);
    sel.value = activeCourierId;
    if (syncForm && !isEditingNow) {
      fillCourierForm(couriersList[0]);
      hasHydratedCourierForm = true;
    }
  }
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    if (mapInstance && btn.dataset.tab === 'ordersTab') {
      setTimeout(() => mapInstance.invalidateSize(), 100);
    }
  });
});

async function loadMobileData(isBackgroundPoll = false) {
  const [couriersRes, ordersRes, rankingRes, mapRes] = await Promise.all([
    fetch('/api/couriers'),
    fetch('/api/orders'),
    fetch('/api/ranking'),
    fetch('/api/location'),
  ]);
  const couriersData = await couriersRes.json();
  const ordersData = await ordersRes.json();
  const rankingData = await rankingRes.json();
  const mapSnapshot = await mapRes.json();

  couriersList = couriersData.couriers || [];
  cachedOrdersList = ordersData.orders || [];
  cachedBatchesList = rankingData.batches || [];
  latestMapSnapshot = mapSnapshot;
  renderCourierSelector(!isBackgroundPoll && !hasHydratedCourierForm);

  initCourierMap();
  renderMapMarkers(mapSnapshot);
  renderCourierFinance();

  document.getElementById('courierCity').textContent = rankingData.city || 'Foz do Iguaçu';
  document.getElementById('mobileRankingPool').textContent = brl(rankingData.calculatedForPool);

  const activeProfile = couriersList.find((c) => c.id === activeCourierId);
  const meInRanking = rankingData.ranking.visibleLeaderboard.find((c) => c.id === activeCourierId);
  const isCourierOnline = activeProfile ? activeProfile.online !== false : true;

  if (activeProfile) {
    document.getElementById('courierName').textContent = activeProfile.name;
    const statusLabelEl = document.getElementById('courierStatusLabel');
    if (activeProfile.approved === false) {
      statusLabelEl.textContent = 'AGUARDANDO APROVAÇÃO ADMIN';
      statusLabelEl.style.color = '#fbbf24';
    } else if (isCourierOnline) {
      statusLabelEl.textContent = 'ONLINE / DISPONÍVEL';
      statusLabelEl.style.color = '#4ade80';
    } else {
      statusLabelEl.textContent = 'OFFLINE / EM PAUSA';
      statusLabelEl.style.color = '#9ca3af';
    }

    const toggleOnlineBtn = document.getElementById('toggleOnlineBtn');
    if (toggleOnlineBtn) {
      toggleOnlineBtn.textContent = isCourierOnline ? 'Ficar Offline' : 'Ficar Online';
      toggleOnlineBtn.style.background = isCourierOnline ? '#1f2937' : '#14532d';
      toggleOnlineBtn.style.borderColor = isCourierOnline ? '#374151' : '#22c55e';
      toggleOnlineBtn.style.color = isCourierOnline ? '#f9fafb' : '#86efac';
    }
  }
  document.getElementById('courierPoints').textContent = meInRanking ? `${meInRanking.points} pts` : '0 pts';

  const closedStatuses = [
    'CONCLUIDO',
    'RECUSADO_PELA_LOJA',
    'CANCELADO_INCIDENTE_REEMBOLSADO',
    'ENCERRADO_POR_INCIDENTE_RECOMPRA',
  ];

  const ordersContainer = document.getElementById('availableOrders');
  const visibleOrders = (ordersData.orders || []).filter((o) => {
    const isMineActive = o.courierId === activeCourierId && !closedStatuses.includes(o.status);
    const isDeclinedByMe =
      Array.isArray(o.declinedByCouriers) && o.declinedByCouriers.includes(activeCourierId);
    const isOpenForMe =
      isCourierOnline && o.status === 'AGUARDANDO_CICLISTA' && !isDeclinedByMe;
    const isRescueForMe =
      isCourierOnline &&
      o.status === 'INCIDENTE_EM_ROTA' &&
      o.isRescueAvailable &&
      o.incident?.firstCourierId !== activeCourierId &&
      !isDeclinedByMe;
    return isMineActive || isOpenForMe || isRescueForMe;
  });

  if (visibleOrders.length === 0) {
    ordersContainer.innerHTML = isCourierOnline
      ? '<p style="color:#9ca3af;font-size:0.9rem;">Nenhuma entrega pendente no momento. Você está ONLINE e pronto para receber chamados.</p>'
      : '<p style="color:#fbbf24;font-size:0.9rem;">Você está OFFLINE (em pausa). Toque em <strong>Ficar Online</strong> acima quando quiser voltar a receber entregas.</p>';
  } else {
    ordersContainer.innerHTML = visibleOrders
      .map((o) => {
        const p1 = o.pricing.ponta1_entregador;
        const action = getStageActionConfig(o);
        const distKm = Number(o.distanceKm || 1.5);
        const estMinutes = Math.max(4, Math.round((distKm / 15) * 60 + 2));
        const totalStops = 2 + Number(o.additionalStops || 0);
        const isRescue =
          o.status === 'INCIDENTE_EM_ROTA' || Boolean(o.incident?.rescueCourierId);
        const isMyOwnIncident =
          o.status === 'INCIDENTE_EM_ROTA' && o.incident?.firstCourierId === activeCourierId;

        let waitBanner = '';
        if (o.status === 'NO_LOCAL_COLETA' && o.timestamps?.arrivedPickupAt) {
          const elapsedMin = Math.max(
            0,
            (Date.now() - new Date(o.timestamps.arrivedPickupAt).getTime()) / 60000
          ).toFixed(1);
          waitBanner = `<div style="margin-top:4px; color:#fbbf24;">Cronômetro de Espera na Loja: <strong>${elapsedMin} min</strong> (5 min grátis; +R$ 0,30/min excedente calculado ao sair)</div>`;
        } else if (p1.billableWaitMinutes > 0) {
          waitBanner = `<div style="margin-top:4px; color:#34d399;">Adicional de Espera Aplicado: <strong>+${p1.billableWaitMinutes} min (+${brl(p1.waitFee)})</strong></div>`;
        }

        let rescueBanner = '';
        if (isMyOwnIncident) {
          rescueBanner = `<div style="margin-top:6px; padding:8px; border-radius:8px; background:#450a0a; color:#fecaca;">
            <strong>SOS Acionado (${o.incident.reason}):</strong> Suporte alertado e sua pontuação está 100% protegida.
            ${o.incident.firstCourierProtectedPayout > 0 ? `Repasse protegido pelo trajeto: <strong>${brl(o.incident.firstCourierProtectedPayout)}</strong>.` : ''}
          </div>`;
        } else if (isRescue && o.incident) {
          const pickupPointLabel =
            o.incident.previousStage === 'EM_ROTA_ENTREGA'
              ? `Transbordo com Ciclista ${o.incident.firstCourierName} (GPS ${Number(o.incident.pickupLocation.lat).toFixed(4)}, ${Number(o.incident.pickupLocation.lng).toFixed(4)})`
              : `Coleta direta na loja ${o.merchantName}`;
          rescueBanner = `<div style="margin-top:6px; padding:8px; border-radius:8px; background:#451a03; color:#fde68a;">
            <strong>Motivo Resgate:</strong> ${o.incident.reason} • <strong>Ponto de Coleta:</strong> ${pickupPointLabel}
          </div>`;
        }

        const notReadyBtnHtml =
          o.status === 'NO_LOCAL_COLETA' && !o.falseReadyReported
            ? `<button type="button" class="btn-decline" style="width:100%; margin-top:6px; background:#7f1d1d; color:#fecaca;" onclick="reportOrderNotReady('${o.id}')">Loja Atrasou / Produto Não Está Pronto (Cobrar Espera Imediata)</button>`
            : o.falseReadyReported
              ? `<div style="margin-top:6px; padding:6px; border-radius:6px; background:#450a0a; color:#fca5a5; font-size:0.82rem;"><strong>Falso Pronto Reportado:</strong> Carência de 5 min anulada. Tempo integral cobrado da loja.</div>`
              : '';

        const deliveryPinInputHtml =
          action && action.isComplete && o.deliveryPin
            ? `<div style="margin-top:8px; display:flex; gap:6px; align-items:center;">
                 <input type="tel" id="pinInput-${o.id}" maxlength="4" placeholder="4 dígitos CPF" style="width:130px; padding:9px; border-radius:8px; border:1px solid #38bdf8; background:#0f172a; color:#f8fafc; font-weight:700; text-align:center;" />
                 <button type="button" class="btn-accept" style="flex:1; margin-top:0;" onclick="finishDelivery('${o.id}', true)">${action.label}</button>
               </div>`
            : '';

        const actionButtonsHtml =
          action && !isMyOwnIncident
            ? o.status === 'AGUARDANDO_CICLISTA'
              ? `<div class="offer-actions-row">
                   <button type="button" class="btn-decline" onclick="declineOffer('${o.id}')">Recusar</button>
                   <button type="button" class="btn-accept" onclick="advanceStage('${o.id}', '${action.nextStage}')">${action.label}</button>
                 </div>`
              : action.isComplete
                ? deliveryPinInputHtml || `<button type="button" class="btn-accept" onclick="finishDelivery('${o.id}', false)">${action.label}</button>`
                : `<button type="button" class="btn-accept" style="${isRescue ? 'background:#f59e0b; color:#1c1917;' : ''}" onclick="advanceStage('${o.id}', '${action.nextStage}')">${action.label}</button>${notReadyBtnHtml}`
            : '';

        const snapOrder = (latestMapSnapshot?.orders || []).find((s) => s.id === o.id);
        const pickupFullLine = formatStreetAndNeighborhood(o.pickupAddress || snapOrder?.pickupAddress, snapOrder?.pickupNeighborhood);
        const dropoffFullLine = formatStreetAndNeighborhood(o.customerAddress || snapOrder?.dropoffAddress, snapOrder?.dropoffNeighborhood);
        const pickupCodeLine = o.pickupCode
          ? `<div style="margin-top:4px; padding:4px 8px; border-radius:6px; background:#0f172a; border:1px solid #38bdf8; color:#bae6fd;">Senha de Coleta no Balcão: <strong style="font-size:1rem; color:#38bdf8;">${o.pickupCode}</strong></div>`
          : '';

        return `
          <div class="delivery-card ${isRescue ? 'rescue-card-highlight' : ''}">
            ${isRescue ? '<span class="rescue-badge">RESGATE PRIORITÁRIO • GANHO DOBRADO (2X + TEMPO)</span>' : ''}
            <div class="delivery-top">
              <strong>${o.merchantName}</strong>
              <span class="payout-tag">${brl(p1.totalPayout)}</span>
            </div>
            <div class="delivery-info">
              Etapa: <strong>${formatStageHuman(o.status)}</strong><br/>
              Trajeto Bike: <strong>${distKm} km • ~${estMinutes} min • ${totalStops} paradas</strong> | Peso: <strong>${o.weightKg || '-'} kg</strong><br/>
              Origem: <strong>${o.originChannel === 'APP_CLIENTE' ? 'App Cliente' : 'Balcão Loja'}</strong> | Cliente: <strong>${getFirstName(o.customerName)}</strong><br/>
              Endereço Coleta: <strong>${pickupFullLine}</strong><br/>
              Endereço Entrega: <strong>${dropoffFullLine}</strong><br/>
              Itens: ${o.itemsSummary || o.category} • Seguro em rota: <strong>ATIVO</strong>
              ${pickupCodeLine}
              ${waitBanner}
              ${rescueBanner}
            </div>
            ${actionButtonsHtml}
          </div>
        `;
      })
      .join('');
  }

  const rankContainer = document.getElementById('mobileRankingList');
  rankContainer.innerHTML = rankingData.ranking.visibleLeaderboard
    .map(
      (item) => `
      <div class="rank-row">
        <div>
          <strong>#${item.rank}</strong> ${item.name} <small style="color:#9ca3af;">(${item.completedDeliveries} entregas)</small>
        </div>
        <div style="text-align:right;">
          <div><strong>${item.points} pts</strong></div>
          <div class="rank-prize">${brl(item.prizeAmount)}</div>
        </div>
      </div>
    `
    )
    .join('');
}

function formatTimeHHMM(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateLongBR(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function maskMoney(val) {
  return hideFinanceValues ? 'R$ ••••' : brl(val);
}

function openRouteDetails(orderId) {
  const order = cachedOrdersList.find((o) => o.id === orderId);
  const modal = document.getElementById('routeDetailModal');
  if (!order || !modal) return;

  const ts = order.timestamps || {};
  const startIso = ts.acceptedAt || ts.createdAt || order.createdAt;
  const endIso = ts.completedAt || order.completedAt || startIso;
  const durationMin = Math.max(
    1,
    Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000)
  );
  const stopsCount = 2 + Number(order.additionalStops || 0);
  const payout = order.pricing?.ponta1_entregador?.totalPayout || 0;

  const steps = [];
  const tAccepted = formatTimeHHMM(ts.acceptedAt || ts.createdAt);
  const tArrived = formatTimeHHMM(ts.arrivedPickupAt);
  const tPicked = formatTimeHHMM(ts.pickedUpAt);
  const tCompleted = formatTimeHHMM(ts.completedAt || order.completedAt);

  if (tAccepted) {
    steps.push(`<li><span>${tAccepted}</span> Rota aceita • Indo para coleta (${order.merchantName})</li>`);
  }
  if (tArrived) {
    steps.push(`<li><span>${tArrived}</span> Chegou na coleta</li>`);
  }
  if (tPicked) {
    steps.push(`<li><span>${tPicked}</span> Saiu da coleta • Em direção ao cliente</li>`);
  }
  if (tCompleted) {
    steps.push(`<li><span>${tCompleted}</span> Pedido entregue • Fim da rota (${order.customerName})</li>`);
  }

  modal.classList.remove('hidden');
  modal.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <strong style="color:#4ade80; font-size:0.82rem;">DETALHES DO LANÇAMENTO</strong>
      <button type="button" class="btn-mini" onclick="closeRouteDetails()">Fechar</button>
    </div>
    <div style="text-align:center; padding: 10px 0; border-bottom: 1px solid #1e293b;">
      <div style="font-size:1.5rem; font-weight:800; color:#f8fafc;">${maskMoney(payout)}</div>
      <div style="font-size:0.85rem; color:#4ade80; font-weight:700;">Rota completa</div>
      <small style="color:#9ca3af;">${formatDateLongBR(endIso)} • ${tCompleted || ''}</small>
    </div>
    <div style="margin-top:10px; font-size:0.84rem;">
      <strong>Resumo da rota</strong>
      <div style="display:flex; justify-content:space-between; margin-top:4px; color:#cbd5e1;">
        <span>Tempo em Rota</span><strong>${durationMin} min (${order.distanceKm || '-'} km)</strong>
      </div>
      <div style="display:flex; justify-content:space-between; margin-top:4px; color:#cbd5e1;">
        <span>Qtd. de paradas</span><strong>${stopsCount} paradas</strong>
      </div>
    </div>
    <div style="margin-top:12px; font-size:0.84rem;">
      <strong>Histórico da rota</strong>
      <ul class="route-timeline">
        ${steps.join('')}
      </ul>
    </div>
  `;
}

function closeRouteDetails() {
  const modal = document.getElementById('routeDetailModal');
  if (modal) modal.classList.add('hidden');
}

function renderCourierFinance() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  const myCompleted = cachedOrdersList.filter((o) => {
    if (o.status !== 'CONCLUIDO' || o.courierId !== activeCourierId) return false;
    const finishedTime = new Date(o.completedAt || o.timestamps?.completedAt || o.createdAt).getTime();
    if (financePeriodFilter === 'TODAY') return finishedTime >= startOfToday;
    if (financePeriodFilter === '7D') return finishedTime >= sevenDaysAgo;
    return true;
  });

  let totalDeliveryEarnings = 0;
  myCompleted.forEach((o) => {
    totalDeliveryEarnings += Number(o.pricing?.ponta1_entregador?.totalPayout || 0);
  });

  const myPixEntries = [];
  let totalPixPrizes = 0;
  cachedBatchesList.forEach((batch) => {
    const myPayout = (batch.payouts || []).find((p) => p.courierId === activeCourierId && Number(p.amountBRL) > 0);
    if (myPayout) {
      totalPixPrizes += Number(myPayout.amountBRL || 0);
      myPixEntries.push({
        batchId: batch.batchId,
        rank: myPayout.rank,
        amountBRL: Number(myPayout.amountBRL || 0),
        status: batch.status || 'AGUARDANDO_PIX',
        closedAt: batch.closedAt,
      });
    }
  });

  document.getElementById('finNetEarnings').textContent = maskMoney(totalDeliveryEarnings);
  document.getElementById('finDeliveriesCount').textContent = String(myCompleted.length);
  document.getElementById('finPixPrizes').textContent = maskMoney(totalPixPrizes);

  const listEl = document.getElementById('financeStatementList');
  if (myCompleted.length === 0 && myPixEntries.length === 0) {
    listEl.innerHTML =
      '<p style="color:#9ca3af; font-size:0.86rem;">Nenhuma entrega concluída neste período. Conclua uma entrega na aba Entregas para visualizar seu extrato.</p>';
    return;
  }

  const pixHtml = myPixEntries
    .map(
      (px) => `
      <div class="statement-row" style="border-color: rgba(56, 189, 248, 0.4);">
        <div class="statement-meta">
          <strong>Prêmio Ranking Semanal (#${px.rank})</strong>
          <small>${formatDateLongBR(px.closedAt)} • Status: ${px.status}</small>
        </div>
        <div class="statement-amount" style="color:#38bdf8;">+${maskMoney(px.amountBRL)}</div>
      </div>
    `
    )
    .join('');

  const deliveriesHtml = myCompleted
    .map((o) => {
      const payout = Number(o.pricing?.ponta1_entregador?.totalPayout || 0);
      const finishedIso = o.completedAt || o.timestamps?.completedAt || o.createdAt;
      const timeLabel = formatTimeHHMM(finishedIso) || '';
      return `
        <div class="statement-row" onclick="openRouteDetails('${o.id}')">
          <div class="statement-meta">
            <strong>Rota completa • ${o.merchantName}</strong>
            <small>${formatDateLongBR(finishedIso)} às ${timeLabel} • Toque para ver horários</small>
          </div>
          <div class="statement-amount">${maskMoney(payout)} &rsaquo;</div>
        </div>
      `;
    })
    .join('');

  listEl.innerHTML = `${pixHtml}${deliveriesHtml}`;
}

async function declineOffer(orderId) {
  const res = await fetch(`/api/orders/${orderId}/decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courierId: activeCourierId }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Não foi possível recusar a corrida.');
    return;
  }
  await loadMobileData(true);
}

async function advanceStage(orderId, nextStage) {
  const activeProfile = couriersList.find((c) => c.id === activeCourierId);
  const res = await fetch(`/api/orders/${orderId}/stage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courierId: activeCourierId,
      courierName: activeProfile?.name,
      stage: nextStage,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Não foi possível avançar a etapa.');
    return;
  }
  await loadMobileData();
}

async function reportOrderNotReady(orderId) {
  const res = await fetch(`/api/orders/${orderId}/not-ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Não foi possível registrar atraso na loja.');
    return;
  }
  await loadMobileData();
}

async function finishDelivery(orderId, requiresPin = false) {
  const activeProfile = couriersList.find((c) => c.id === activeCourierId);
  let deliveryPin = '';
  if (requiresPin) {
    const inputEl = document.getElementById(`pinInput-${orderId}`);
    deliveryPin = inputEl ? String(inputEl.value || '').trim() : '';
    if (deliveryPin.length !== 4) {
      alert('Digite os 4 últimos dígitos do CPF informados pelo cliente.');
      return;
    }
  }

  const res = await fetch(`/api/orders/${orderId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courierId: activeCourierId,
      courierName: activeProfile?.name,
      deliveryPin,
      onTime: true,
      fiveStar: false,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Erro ao concluir entrega.');
    return;
  }
  await loadMobileData();
}

async function sendPositionToBackend(lat, lng, accuracy) {
  const activeProfile = couriersList.find((c) => c.id === activeCourierId);
  await fetch('/api/location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courierId: activeCourierId,
      name: activeProfile?.name,
      lat,
      lng,
      accuracy,
    }),
  });
  await loadMobileData();
}

document.getElementById('gpsBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    await sendPositionToBackend(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
  });
});

document.getElementById('autoGpsBtn').addEventListener('click', () => {
  const btn = document.getElementById('autoGpsBtn');
  if (!navigator.geolocation) return;

  if (autoGpsWatchId !== null) {
    navigator.geolocation.clearWatch(autoGpsWatchId);
    autoGpsWatchId = null;
    btn.textContent = 'GPS Auto: OFF';
    return;
  }

  btn.textContent = 'GPS Auto: ON';
  autoGpsWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      await sendPositionToBackend(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    () => {
      btn.textContent = 'GPS Auto: ERRO';
    },
    { enableHighAccuracy: true, maximumAge: 4000, timeout: 10000 }
  );
});

document.getElementById('courierProfileForm').addEventListener('input', () => {
  isCourierFormDirty = true;
});

document.getElementById('courierSelector').addEventListener('change', (e) => {
  activeCourierId = e.target.value;
  isCourierFormDirty = false;
  hasHydratedCourierForm = true;
  if (activeCourierId === '__NEW__') {
    fillCourierForm(null);
    return;
  }
  localStorage.setItem(COURIER_STORAGE_KEY, activeCourierId);
  const found = couriersList.find((c) => c.id === activeCourierId);
  fillCourierForm(found);
  loadMobileData(true);
});

document.getElementById('courierProfileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const isCreatingNew = activeCourierId === '__NEW__';
  const payload = {
    id: isCreatingNew ? undefined : activeCourierId,
    name: document.getElementById('cName').value,
    phone: document.getElementById('cPhone').value,
    pixKey: document.getElementById('cPixKey').value,
  };

  const res = await fetch('/api/couriers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await res.json();
  const fb = document.getElementById('courierProfileFeedback');

  if (!res.ok) {
    fb.textContent = result.error || 'Erro ao salvar perfil do ciclista.';
    return;
  }

  activeCourierId = result.courier.id;
  localStorage.setItem(COURIER_STORAGE_KEY, activeCourierId);
  isCourierFormDirty = false;
  hasHydratedCourierForm = false;
  fb.textContent = `Cadastro e chave Pix de ${result.courier.name} salvos com sucesso!`;
  await loadMobileData(false);
});

document.getElementById('toggleFinancePrivacyBtn').addEventListener('click', (e) => {
  hideFinanceValues = !hideFinanceValues;
  e.target.textContent = hideFinanceValues ? 'Mostrar' : 'Ocultar';
  renderCourierFinance();
});

document.querySelectorAll('.fin-period-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.fin-period-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    financePeriodFilter = btn.dataset.period;
    closeRouteDetails();
    renderCourierFinance();
  });
});

document.getElementById('toggleOnlineBtn').addEventListener('click', async () => {
  const res = await fetch(`/api/couriers/${encodeURIComponent(activeCourierId)}/availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Erro ao alterar disponibilidade.');
    return;
  }
  await loadMobileData(true);
});

let selectedSosCargoCondition = 'INTACTA';

function setSosCargoCondition(cond) {
  selectedSosCargoCondition = cond;
  const intactBtn = document.getElementById('cargoIntactBtn');
  const damagedBtn = document.getElementById('cargoDamagedBtn');
  if (intactBtn && damagedBtn) {
    intactBtn.style.borderColor = cond === 'INTACTA' ? '#22c55e' : '#374151';
    intactBtn.style.background = cond === 'INTACTA' ? '#14532d' : '#1f2937';
    damagedBtn.style.borderColor = cond === 'DANIFICADA' ? '#ef4444' : '#374151';
    damagedBtn.style.background = cond === 'DANIFICADA' ? '#7f1d1d' : '#1f2937';
  }
}

function centerMapOnCourier() {
  if (!mapInstance) return;
  const applyView = (lat, lng) => mapInstance.setView([lat, lng], 16);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        applyView(pos.coords.latitude, pos.coords.longitude);
        await sendPositionToBackend(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      },
      () => {
        const stored = (latestMapSnapshot?.couriers || []).find((c) => c.id === activeCourierId);
        applyView(stored ? stored.lat : -25.5478, stored ? stored.lng : -54.5882);
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
    return;
  }

  const stored = (latestMapSnapshot?.couriers || []).find((c) => c.id === activeCourierId);
  applyView(stored ? stored.lat : -25.5478, stored ? stored.lng : -54.5882);
}

function closeSosModal() {
  const modal = document.getElementById('sosModal');
  if (modal) modal.classList.add('hidden');
}

function openSosModal() {
  const modal = document.getElementById('sosModal');
  if (!modal) return;
  selectedSosCargoCondition = 'INTACTA';
  modal.classList.remove('hidden');
  modal.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <strong style="color:#fca5a5; font-size:0.9rem;">CENTRAL SOS • SEGURO EM ROTA ATIVA</strong>
      <button type="button" class="btn-mini" onclick="closeSosModal()">Fechar</button>
    </div>
    <p style="font-size:0.8rem; color:#fecaca; margin:8px 0;">
      Você não perde pontos no ranking. Informe primeiro o estado da encomenda e depois toque no motivo:
    </p>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px;">
      <button type="button" id="cargoIntactBtn" class="btn-mini" style="background:#14532d; border-color:#22c55e; font-weight:700;" onclick="setSosCargoCondition('INTACTA')">
        Encomenda Intacta (Resgate 2x)
      </button>
      <button type="button" id="cargoDamagedBtn" class="btn-mini" style="background:#1f2937; border-color:#374151; font-weight:700;" onclick="setSosCargoCondition('DANIFICADA')">
        Encomenda Danificada / Virou
      </button>
    </div>
    <div class="sos-options-grid">
      <button type="button" class="btn-sos-trigger" onclick="submitSosAlert('ACIDENTE / QUEDA (ACIONAR SEGURO)')">
        1. Acidente ou Queda (Acionar Seguro)
      </button>
      <button type="button" class="btn-sos-trigger" style="background:#7f1d1d;" onclick="submitSosAlert('PANE MECÂNICA NA BIKE')">
        2. Pane Mecânica na Bicicleta (Pneu / Corrente)
      </button>
      <button type="button" class="btn-sos-trigger" style="background:#7f1d1d;" onclick="submitSosAlert('RISCO DE SEGURANÇA NA VIA')">
        3. Risco de Segurança / Via Bloqueada
      </button>
    </div>
    <div id="sosFeedbackBox" style="margin-top:8px; font-size:0.82rem; color:#fde047;"></div>
  `;
}

async function submitSosAlert(reason) {
  const fb = document.getElementById('sosFeedbackBox');
  if (fb) fb.textContent = 'Transmitindo GPS e acionando protocolo de contingência...';

  const activeProfile = couriersList.find((c) => c.id === activeCourierId);
  const storedLoc = (latestMapSnapshot?.couriers || []).find((c) => c.id === activeCourierId);
  const currentActiveOrder = cachedOrdersList.find(
    (o) =>
      o.courierId === activeCourierId &&
      [
        'ACEITO_PELO_CICLISTA',
        'NO_LOCAL_COLETA',
        'RESGATE_EM_ANDAMENTO',
        'EM_ROTA_ENTREGA',
      ].includes(o.status)
  );

  const dispatch = async (lat, lng, accuracy = null) => {
    const res = await fetch('/api/sos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courierId: activeCourierId,
        courierName: activeProfile?.name,
        activeOrderId: currentActiveOrder?.id || null,
        reason,
        cargoCondition: selectedSosCargoCondition,
        lat,
        lng,
        accuracy,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (fb) fb.textContent = data.error || 'Falha ao enviar SOS.';
      return;
    }
    if (fb) {
      fb.innerHTML = `Protocolo <strong>${data.alert.id}</strong> ativo! Suporte e cliente notificados.`;
    }
    await loadMobileData(true);
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => dispatch(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
      () => dispatch(storedLoc ? storedLoc.lat : -25.5478, storedLoc ? storedLoc.lng : -54.5882),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  } else {
    await dispatch(storedLoc ? storedLoc.lat : -25.5478, storedLoc ? storedLoc.lng : -54.5882);
  }
}

document.getElementById('centerGpsBtn').addEventListener('click', centerMapOnCourier);
document.getElementById('sosBtn').addEventListener('click', openSosModal);

document.getElementById('reloadBtn').addEventListener('click', () => loadMobileData(true));
loadMobileData(false);
setInterval(() => loadMobileData(true), 5000);