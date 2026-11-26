const { calculateDeliveryPricing } = require('../services/pricingEngine');
const { buildWeeklyRanking } = require('../services/rankingEngine');

console.log('=== TESTE 1: Rota Farmácia/Lanche 2.5km com 15 min de espera na loja ===');
console.log(
  JSON.stringify(
    calculateDeliveryPricing({
      distanceKm: 2.5,
      weightKg: 1.2,
      category: 'FAST_FOOD_COMPACTO',
      additionalStops: 0,
      waitMinutes: 15, // 5 min grátis + 10 min cobrados = R$ 3,00 ao ciclista
      orderValue: 55.0,
      isActiveRoute: true,
    }),
    null,
    2
  )
);

console.log('\n=== TESTE 2: Bloqueio de carga fora do padrão bike (14 kg) ===');
console.log(
  JSON.stringify(
    calculateDeliveryPricing({
      distanceKm: 2.0,
      weightKg: 14.0,
      category: 'FARMACIA_LEVE',
      orderValue: 120.0,
    }),
    null,
    2
  )
);

console.log('\n=== TESTE 3: Ranking Semanal (Fundo de R$ 1.000,00) ===');
const sampleCouriers = Array.from({ length: 25 }, (_, i) => ({
  id: `bike-${i + 1}`,
  name: `Ciclista ${i + 1}`,
  city: 'Foz do Iguaçu',
  previousRank: i + 3,
  metrics: {
    completedDeliveries: Math.max(2, 40 - i * 1.5),
    onTimeDeliveries: Math.max(1, 35 - i),
    fiveStarRatings: Math.max(1, 30 - i),
    peakOrRainDeliveries: i < 5 ? 6 : 1,
    unjustifiedCancels: 0,
    severeLateDeliveries: 0,
  },
}));

const ranking = buildWeeklyRanking(sampleCouriers, 1000.0);
console.log('Top 5:', ranking.visibleLeaderboard.slice(0, 5));
console.log('12º lugar (faixa 11-20):', ranking.visibleLeaderboard[11]);
console.log('22º lugar (fora Top 20, dentro Top 50):', ranking.visibleLeaderboard[21]);