const fs = require('fs');
const path = require('path');

const DATA_FILE = path.resolve(__dirname, '../../data/store.json');
const BACKUP_DIR = path.resolve(__dirname, '../../data/backups');

const DEFAULT_STATE = {
  city: 'Foz do Iguaçu',
  funds: {
    opsFund: 0,
    weeklyRankingPool: 0,
    insurancePool: 0,
  },
  customers: [
    {
      id: 'cust-padrao',
      name: 'Morador Teste Foz',
      phone: '(45) 99999-0001',
      address: 'Av. Brasil, 1200',
      neighborhood: 'CENTRO',
      lat: -25.5427,
      lng: -54.5855,
      createdAt: '2026-11-01T10:00:00.000Z',
    },
  ],
  merchants: [
    {
      id: 'merch-farmacia-central',
      name: 'Farmácia Central — Centro',
      cnpjOrCpf: '12.345.678/0001-90',
      category: 'FARMACIA_LEVE',
      address: 'Av. Jorge Schimmelpfeng, 450',
      neighborhood: 'CENTRO',
      lat: -25.5478,
      lng: -54.5882,
      approved: true,
      createdAt: '2026-11-01T10:00:00.000Z',
    },
    {
      id: 'merch-burger-vila-a',
      name: 'Burger / Lanches Express — Vila A',
      cnpjOrCpf: '98.765.432/0001-10',
      category: 'FAST_FOOD_COMPACTO',
      address: 'Av. Silvio Américo Sasdelli, 1850',
      neighborhood: 'VILA_A',
      lat: -25.5145,
      lng: -54.5768,
      approved: true,
      createdAt: '2026-11-01T10:00:00.000Z',
    },
  ],
  products: [
    {
      id: 'prod-1',
      merchantId: 'merch-farmacia-central',
      name: 'Dipirona 500mg + Vitamina C (Kit Leve)',
      category: 'FARMACIA_LEVE',
      weightKg: 0.4,
      priceBRL: 34.9,
      active: true,
    },
    {
      id: 'prod-2',
      merchantId: 'merch-farmacia-central',
      name: 'Protetor Solar FPS 50 + Hidratante',
      category: 'FARMACIA_LEVE',
      weightKg: 0.6,
      priceBRL: 68.0,
      active: true,
    },
    {
      id: 'prod-3',
      merchantId: 'merch-burger-vila-a',
      name: 'Combo Lanche Artesanal Individual + Suco',
      category: 'FAST_FOOD_COMPACTO',
      weightKg: 0.9,
      priceBRL: 42.0,
      active: true,
    },
  ],
  orders: [],
  couriers: [
    {
      id: 'bike-andre',
      name: 'André Luiz Trindade',
      phone: '(45) 99999-1000',
      pixKey: 'andre.bikapp@pix.local',
      approved: true,
      online: true,
      city: 'Foz do Iguaçu',
      previousRank: 1,
      metrics: {
        completedDeliveries: 12,
        onTimeDeliveries: 12,
        fiveStarRatings: 11,
        peakOrRainDeliveries: 2,
        unjustifiedCancels: 0,
        severeLateDeliveries: 0,
      },
    },
  ],
  weeklyBatches: [],
  liveLocations: [],
  sosAlerts: [],
};

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_STATE, null, 2), 'utf8');
  }
}

function normalizeStore(parsed) {
  const state = {
    ...DEFAULT_STATE,
    ...parsed,
    funds: {
      ...DEFAULT_STATE.funds,
      ...(parsed.funds || {}),
    },
  };

  if (!Array.isArray(state.customers)) {
    state.customers = [];
  }
  if (!Array.isArray(state.merchants) || state.merchants.length === 0) {
    state.merchants = [...DEFAULT_STATE.merchants];
  }
  if (!Array.isArray(state.products) || state.products.length === 0) {
    state.products = [...DEFAULT_STATE.products];
  }
  if (!Array.isArray(state.orders)) {
    state.orders = [];
  }
  if (!Array.isArray(state.couriers) || state.couriers.length === 0) {
    state.couriers = [...DEFAULT_STATE.couriers];
  } else {
    state.couriers = state.couriers.map((c) => ({
      pixKey: '',
      phone: '',
      approved: true,
      online: true,
      ...c,
    }));
  }
  if (!Array.isArray(state.weeklyBatches)) {
    state.weeklyBatches = [];
  } else {
    state.weeklyBatches = state.weeklyBatches.map((b) => ({
      ...b,
      status:
        b.status ||
        (b.paidAt
          ? 'PAGO_VIA_PIX'
          : Number(b.totalAllocated || 0) > 0
            ? 'AGUARDANDO_PIX'
            : 'SEM_SALDO'),
    }));
  }
  if (!Array.isArray(state.liveLocations)) {
    state.liveLocations = [];
  }
  if (!Array.isArray(state.sosAlerts)) {
    state.sosAlerts = [];
  }

  return state;
}

function readStore() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  return normalizeStore(JSON.parse(raw));
}

function writeStore(nextState) {
  ensureDataFile();
  const normalized = normalizeStore(nextState);
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

function backupStore(reason = 'manual') {
  ensureDataFile();
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `store-${reason}-${stamp}.json`;
  const targetPath = path.join(BACKUP_DIR, fileName);
  fs.copyFileSync(DATA_FILE, targetPath);

  // Mantém no máximo os 20 backups mais recentes
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  while (files.length > 20) {
    const oldest = files.shift();
    fs.unlinkSync(path.join(BACKUP_DIR, oldest));
  }

  return {
    fileName,
    createdAt: new Date().toISOString(),
  };
}

function resetDevStore() {
  const backup = backupStore('pre-reset-dev');
  const current = readStore();

  const cleanCouriers = (current.couriers || DEFAULT_STATE.couriers).map((c, idx) => ({
    ...c,
    previousRank: idx + 1,
    metrics: {
      completedDeliveries: 0,
      onTimeDeliveries: 0,
      fiveStarRatings: 0,
      peakOrRainDeliveries: 0,
      unjustifiedCancels: 0,
      severeLateDeliveries: 0,
    },
  }));

  const cleanState = {
    city: current.city || DEFAULT_STATE.city,
    funds: {
      opsFund: 0,
      weeklyRankingPool: 0,
      insurancePool: 0,
    },
    customers: [],
    merchants:
      Array.isArray(current.merchants) && current.merchants.length > 0
        ? current.merchants
        : [...DEFAULT_STATE.merchants],
    products:
      Array.isArray(current.products) && current.products.length > 0
        ? current.products
        : [...DEFAULT_STATE.products],
    orders: [],
    couriers: cleanCouriers,
    weeklyBatches: [],
    liveLocations: [],
    sosAlerts: [],
  };

  writeStore(cleanState);
  return {
    backup,
    state: cleanState,
  };
}

module.exports = {
  DATA_FILE,
  readStore,
  writeStore,
  backupStore,
  resetDevStore,
};