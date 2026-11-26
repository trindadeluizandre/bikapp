const { BIKE_RULES } = require('../config/rules');

function roundMoney(value) {
  return Number(value.toFixed(2));
}

function validateBikeOrder({ distanceKm, weightKg, category }) {
  const errors = [];

  if (!BIKE_RULES.allowedCategories.includes(category)) {
    errors.push(`Categoria "${category}" não permitida para o modal bike.`);
  }
  if (weightKg > BIKE_RULES.maxWeightKg) {
    errors.push(`Peso (${weightKg} kg) excede o limite do modal bike (${BIKE_RULES.maxWeightKg} kg).`);
  }
  if (distanceKm > BIKE_RULES.maxRadiusKm) {
    errors.push(`Distância (${distanceKm} km) excede o raio máximo bike (${BIKE_RULES.maxRadiusKm} km).`);
  }

  return {
    allowed: errors.length === 0,
    errors,
  };
}

function calculateDeliveryPricing({
  distanceKm,
  weightKg,
  category,
  additionalStops = 0,
  waitMinutes = 0,
  orderValue = 0,
  isActiveRoute = true,
}) {
  const validation = validateBikeOrder({ distanceKm, weightKg, category });
  if (!validation.allowed) {
    return {
      approved: false,
      validation,
    };
  }

  // Ponta 1: Entregador
  const extraKm = Math.max(0, distanceKm - BIKE_RULES.baseIncludedKm);
  const kmFee = extraKm * BIKE_RULES.perKmFee;
  const stopsFee = Math.max(0, additionalStops) * BIKE_RULES.additionalStopFee;
  const billableWaitMinutes = Math.max(0, waitMinutes - BIKE_RULES.freeWaitMinutes);
  const waitFee = billableWaitMinutes * BIKE_RULES.waitFeePerMinute;

  const courierPayout = roundMoney(BIKE_RULES.baseDeliveryFee + kmFee + stopsFee + waitFee);

  // Ponta 3: Plataforma BikApp (R$ 1,80 por entrega + 1,80 por parada adicional concluída)
  const totalDeliveriesCount = 1 + Math.max(0, additionalStops);
  const platformTotalFee = roundMoney(BIKE_RULES.platformFixedFee * totalDeliveriesCount);
  const platformOpsAmount = roundMoney(BIKE_RULES.platformOpsShare * totalDeliveriesCount);
  const rankingPoolContribution = roundMoney(BIKE_RULES.rankingPoolShare * totalDeliveriesCount);
  const insurancePoolContribution = roundMoney(BIKE_RULES.insurancePoolShare * totalDeliveriesCount);

  // Ponta 2: Empresa contratante (0% comissão sobre o valor do produto)
  const merchantProductCommission = roundMoney(
    orderValue * BIKE_RULES.merchantProductCommissionPct
  );
  const merchantTotalCost = roundMoney(
    courierPayout + platformTotalFee + merchantProductCommission
  );

  return {
    approved: true,
    validation,
    insuranceActiveInRoute: Boolean(isActiveRoute),
    ponta1_entregador: {
      baseFee: roundMoney(BIKE_RULES.baseDeliveryFee),
      extraKm: Number(extraKm.toFixed(2)),
      kmFee: roundMoney(kmFee),
      additionalStops: Math.max(0, additionalStops),
      stopsFee: roundMoney(stopsFee),
      billableWaitMinutes: Number(billableWaitMinutes.toFixed(1)),
      waitFee: roundMoney(waitFee),
      totalPayout: courierPayout,
    },
    ponta2_empresa: {
      orderValue: roundMoney(orderValue),
      productCommission: merchantProductCommission,
      totalCost: merchantTotalCost,
    },
    ponta3_bikapp: {
      totalFee: platformTotalFee,
      opsFund: platformOpsAmount,
      rankingFundContribution: rankingPoolContribution,
      insuranceFundContribution: insurancePoolContribution,
    },
  };
}

function calculateRescuePricing(originalPricing, elapsedIncidentMinutes = 5) {
  const baseP1 = Number(originalPricing?.ponta1_entregador?.totalPayout || BIKE_RULES.baseDeliveryFee);
  const doubledPayout = roundMoney(baseP1 * 2);
  const timeCompensationFee = roundMoney(
    2.0 + Math.max(0, Number(elapsedIncidentMinutes || 0)) * BIKE_RULES.waitFeePerMinute
  );
  const rescueTotalPayout = roundMoney(doubledPayout + timeCompensationFee);
  const fundSubsidyRequired = roundMoney(rescueTotalPayout - baseP1);

  return {
    originalPayout: baseP1,
    doubledPayout,
    timeCompensationFee,
    rescueTotalPayout,
    fundSubsidyRequired,
  };
}

module.exports = {
  validateBikeOrder,
  calculateDeliveryPricing,
  calculateRescuePricing,
};