const BIKE_RULES = {
  modal: 'BIKE_ONLY',
  maxRadiusKm: 4.5,
  allowedCategories: ['FARMACIA_LEVE', 'FAST_FOOD_COMPACTO', 'CONVENIENCIA_LEVE'],
  maxWeightKg: 8.0,

  // Ponta 1: Entregador (prioridade máxima)
  baseDeliveryFee: 8.0,
  baseIncludedKm: 1.5,
  perKmFee: 1.6,
  additionalStopFee: 6.5, // Sem subprecificação de R$ 3,00 em entregas múltiplas
  freeWaitMinutes: 5,
  waitFeePerMinute: 0.3,

  // Ponta 2: Empresa contratante (0% sobre produto, sem mensalidade inicial)
  merchantProductCommissionPct: 0.0,

  // Ponta 3: Plataforma BikApp (R$ 1,80 fixo por entrega concluída)
  platformFixedFee: 1.8,
  platformOpsShare: 0.8,
  rankingPoolShare: 0.65,
  insurancePoolShare: 0.35,

  // Ranking Semanal (Exibição Top 50 / Premiação Top 20)
  rankingVisibleLimit: 50,
  points: {
    completedDelivery: 100,
    onTimeBonus: 25,
    fiveStarBonus: 20,
    peakOrRainBonus: 30,
    unjustifiedCancelPenalty: -80,
    severeLatePenalty: -30,
  },
  prizeShares: {
    top1: 0.22,
    top2: 0.14,
    top3: 0.1,
    top4To10Each: 0.045,
    top11To20Each: 0.0225,
  },
};

module.exports = { BIKE_RULES };