const { BIKE_RULES } = require('../config/rules');

function roundMoney(value) {
  return Number(value.toFixed(2));
}

function calculateCourierPoints(metrics) {
  const {
    completedDeliveries = 0,
    onTimeDeliveries = 0,
    fiveStarRatings = 0,
    peakOrRainDeliveries = 0,
    unjustifiedCancels = 0,
    severeLateDeliveries = 0,
  } = metrics;

  const points =
    completedDeliveries * BIKE_RULES.points.completedDelivery +
    onTimeDeliveries * BIKE_RULES.points.onTimeBonus +
    fiveStarRatings * BIKE_RULES.points.fiveStarBonus +
    peakOrRainDeliveries * BIKE_RULES.points.peakOrRainBonus +
    unjustifiedCancels * BIKE_RULES.points.unjustifiedCancelPenalty +
    severeLateDeliveries * BIKE_RULES.points.severeLatePenalty;

  return Math.max(0, points);
}

function buildWeeklyRanking(couriers, weeklyPoolAmount) {
  const ranked = couriers
    .map((courier) => ({
      id: courier.id,
      name: courier.name,
      city: courier.city || 'Foz do Iguaçu',
      points: calculateCourierPoints(courier.metrics || {}),
      previousRank: courier.previousRank || null,
      completedDeliveries: (courier.metrics && courier.metrics.completedDeliveries) || 0,
    }))
    .sort((a, b) => b.points - a.points || b.completedDeliveries - a.completedDeliveries)
    .map((item, index) => {
      const rank = index + 1;
      let prizeAmount = 0;

      if (rank === 1) {
        prizeAmount = weeklyPoolAmount * BIKE_RULES.prizeShares.top1;
      } else if (rank === 2) {
        prizeAmount = weeklyPoolAmount * BIKE_RULES.prizeShares.top2;
      } else if (rank === 3) {
        prizeAmount = weeklyPoolAmount * BIKE_RULES.prizeShares.top3;
      } else if (rank >= 4 && rank <= 10) {
        prizeAmount = weeklyPoolAmount * BIKE_RULES.prizeShares.top4To10Each;
      } else if (rank >= 11 && rank <= 20) {
        prizeAmount = weeklyPoolAmount * BIKE_RULES.prizeShares.top11To20Each;
      }

      const rankDelta = item.previousRank ? item.previousRank - rank : 0;

      return {
        rank,
        ...item,
        rankDelta,
        prizeAmount: roundMoney(prizeAmount),
      };
    });

  return {
    poolTotal: roundMoney(weeklyPoolAmount),
    visibleLeaderboard: ranked.slice(0, BIKE_RULES.rankingVisibleLimit),
    prizedTop20: ranked.slice(0, 20),
  };
}

module.exports = {
  calculateCourierPoints,
  buildWeeklyRanking,
};