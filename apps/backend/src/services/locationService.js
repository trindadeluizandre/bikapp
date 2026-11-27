const { readStore, writeStore } = require('./storeService');

const DEFAULT_FOZ_CENTER = {
  lat: -25.5478,
  lng: -54.5882,
};

const FOZ_NEIGHBORHOODS = {
  CENTRO: { label: 'Centro', lat: -25.5478, lng: -54.5882 },
  VILA_YOLANDA: { label: 'Vila Yolanda / Av. Cataratas', lat: -25.5562, lng: -54.5775 },
  JARDIM_POLO_CENTRO: { label: 'Jardim Polo Centro / JL', lat: -25.5355, lng: -54.5734 },
  BOICY: { label: 'Jardim Guarapuava / Boicy', lat: -25.5432, lng: -54.5688 },
  VILA_MARACANA: { label: 'Vila Maracanã', lat: -25.5338, lng: -54.5859 },
  VILA_A: { label: 'Vila A', lat: -25.5145, lng: -54.5768 },
  JARDIM_CENTRAL: { label: 'Jardim Central / Vila Portes', lat: -25.5179, lng: -54.5952 },
  CAMPOS_IGUACU: { label: 'Campos do Iguaçu', lat: -25.5375, lng: -54.5542 },
};

function getNeighborhoodCoords(code) {
  const key = String(code || 'CENTRO').toUpperCase();
  return FOZ_NEIGHBORHOODS[key] || FOZ_NEIGHBORHOODS.CENTRO;
}

function estimateBikeDistanceKm(originCoords, destCoords) {
  if (!originCoords || !destCoords) return 1.8;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(Number(destCoords.lat) - Number(originCoords.lat));
  const dLng = toRad(Number(destCoords.lng) - Number(originCoords.lng));
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(Number(originCoords.lat))) *
    Math.cos(toRad(Number(destCoords.lat))) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightKm = R * c;
  // Fator urbano de ciclovia/ruas em Foz do Iguaçu (1.28x linha reta, mínimo 0.8 km)
  const bikeKm = Math.max(0.8, straightKm * 1.28);
  return Number(bikeKm.toFixed(2));
}

function updateCourierLocation({
  courierId = 'bike-andre',
  name,
  lat,
  lng,
  accuracy = null,
  activeOrderId = null,
}) {
  const store = readStore();
  if (!Array.isArray(store.liveLocations)) {
    store.liveLocations = [];
  }

  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) {
    throw new Error('Coordenadas de latitude/longitude inválidas.');
  }

  const courierProfile = (store.couriers || []).find((c) => c.id === courierId);

  const record = {
    courierId,
    name: name || courierProfile?.name || 'André Luiz Trindade',
    lat: parsedLat,
    lng: parsedLng,
    accuracy: accuracy !== null ? Number(accuracy) : null,
    activeOrderId,
    updatedAt: new Date().toISOString(),
  };

  const idx = store.liveLocations.findIndex((item) => item.courierId === courierId);
  if (idx >= 0) {
    store.liveLocations[idx] = record;
  } else {
    store.liveLocations.push(record);
  }

  writeStore(store);
  return record;
}

function getLiveMapSnapshot() {
  const store = readStore();
  const locations =
    store.liveLocations.length > 0
      ? store.liveLocations
      : [
        {
          courierId: 'bike-andre',
          name: 'André Luiz Trindade',
          lat: DEFAULT_FOZ_CENTER.lat,
          lng: DEFAULT_FOZ_CENTER.lng,
          accuracy: null,
          activeOrderId: null,
          updatedAt: new Date().toISOString(),
        },
      ];

  const activeOrders = (store.orders || []).map((order, index) => {
    const fallbackOffsetLat = (index % 5) * 0.002 - 0.004;
    const fallbackOffsetLng = ((index % 4) - 1.5) * 0.002;

    const merchant = (store.merchants || []).find((m) => m.id === order.merchantId);
    const customer = (store.customers || []).find((c) => c.id === order.customerId);

    const pickupCoords = order.pickupCoords || {
      lat: Number((merchant?.lat ?? DEFAULT_FOZ_CENTER.lat + fallbackOffsetLat).toFixed(6)),
      lng: Number((merchant?.lng ?? DEFAULT_FOZ_CENTER.lng + fallbackOffsetLng).toFixed(6)),
    };

    const dropoffCoords = order.dropoffCoords || {
      lat: Number((customer?.lat ?? pickupCoords.lat + 0.006).toFixed(6)),
      lng: Number((customer?.lng ?? pickupCoords.lng + 0.005).toFixed(6)),
    };

    const pickupNbCode = String(order.pickupNeighborhood || merchant?.neighborhood || '').toUpperCase();
    const dropoffNbCode = String(order.dropoffNeighborhood || customer?.neighborhood || '').toUpperCase();

    return {
      id: order.id,
      merchantId: order.merchantId || null,
      merchantName: order.merchantName || merchant?.name || 'Estabelecimento',
      pickupAddress: order.pickupAddress || merchant?.address || '',
      pickupNeighborhood: FOZ_NEIGHBORHOODS[pickupNbCode]?.label || '',
      customerId: order.customerId || null,
      customerName: order.customerName || customer?.name || 'Cliente',
      dropoffAddress: order.customerAddress || customer?.address || '',
      dropoffNeighborhood: FOZ_NEIGHBORHOODS[dropoffNbCode]?.label || '',
      pickupCode: order.pickupCode || null,
      distanceKm: order.distanceKm || 1.5,
      weightKg: order.weightKg || 0.5,
      itemsSummary: order.itemsSummary || order.category,
      originChannel: order.originChannel || 'BALCAO_LOJISTA',
      category: order.category,
      status: order.status,
      courierId: order.courierId || null,
      pickupCoords,
      dropoffCoords,
      payoutBRL: order.pricing?.ponta1_entregador?.totalPayout ?? 0,
      insuranceActive: Boolean(order.pricing?.insuranceActiveInRoute),
    };
  });

  return {
    city: store.city || 'Foz do Iguaçu',
    center: DEFAULT_FOZ_CENTER,
    neighborhoods: FOZ_NEIGHBORHOODS,
    couriers: locations,
    orders: activeOrders,
  };
}

module.exports = {
  DEFAULT_FOZ_CENTER,
  FOZ_NEIGHBORHOODS,
  getNeighborhoodCoords,
  estimateBikeDistanceKm,
  updateCourierLocation,
  getLiveMapSnapshot,
};