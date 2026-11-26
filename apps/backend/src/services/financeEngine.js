const { buildWeeklyRanking } = require('./rankingEngine');
const { readStore, writeStore, backupStore } = require('./storeService');

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function generateWeeklyPayoutBatch({ resetPoolAfterClose = true } = {}) {
  backupStore('pre-close-week');
  const store = readStore();
  const poolAvailable = roundMoney(store.funds.weeklyRankingPool);
  const approvedCouriers = (store.couriers || []).filter((c) => c.approved !== false);
  const rankingResult = buildWeeklyRanking(approvedCouriers, poolAvailable);

  const payoutItems = rankingResult.prizedTop20
    .filter((entry) => entry.prizeAmount > 0)
    .map((entry) => {
      const profile = approvedCouriers.find((c) => c.id === entry.id);
      return {
        rank: entry.rank,
        courierId: entry.id,
        courierName: entry.name,
        pixKey: profile?.pixKey || 'CHAVE_PIX_PENDENTE',
        points: entry.points,
        amountBRL: roundMoney(entry.prizeAmount),
        payoutMethod: 'PIX_TRANSFER',
        status: 'PENDENTE_LIQUIDACAO',
      };
    });

  const totalAllocated = roundMoney(
    payoutItems.reduce((acc, item) => acc + item.amountBRL, 0)
  );

  const batchRecord = {
    batchId: `week-${Date.now()}`,
    closedAt: new Date().toISOString(),
    paidAt: null,
    status: payoutItems.length > 0 ? 'AGUARDANDO_PIX' : 'SEM_SALDO',
    city: store.city,
    poolBeforeClose: poolAvailable,
    totalAllocated,
    unallocatedRemainder: roundMoney(poolAvailable - totalAllocated),
    insuranceReserveSnapshot: roundMoney(store.funds.insurancePool),
    opsFundSnapshot: roundMoney(store.funds.opsFund),
    beneficiariesCount: payoutItems.length,
    payouts: payoutItems,
  };

  store.weeklyBatches.unshift(batchRecord);

  if (resetPoolAfterClose && totalAllocated > 0) {
    store.funds.weeklyRankingPool = roundMoney(Math.max(0, poolAvailable - totalAllocated));
  }

  writeStore(store);
  return batchRecord;
}

function markWeeklyBatchPaid(batchId) {
  backupStore('pre-pay-batch');
  const store = readStore();
  const batch = (store.weeklyBatches || []).find((b) => b.batchId === batchId);

  if (!batch) {
    throw new Error('Lote semanal não encontrado.');
  }
  if (batch.status === 'PAGO_VIA_PIX') {
    throw new Error('Este lote já foi liquidado via Pix anteriormente.');
  }

  const nowIso = new Date().toISOString();
  batch.status = 'PAGO_VIA_PIX';
  batch.paidAt = nowIso;
  batch.payouts = (batch.payouts || []).map((p) => ({
    ...p,
    status: 'PAGO_VIA_PIX',
    paidAt: nowIso,
  }));

  writeStore(store);
  return batch;
}

module.exports = {
  generateWeeklyPayoutBatch,
  markWeeklyBatchPaid,
};