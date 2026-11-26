const BASE_URL = process.env.BIKAPP_URL || 'http://localhost:3333';

const NEIGHBORHOODS = [
  'CENTRO',
  'VILA_A',
  'VILA_YOLANDA',
  'JARDIM_CENTRAL',
  'PORTO_MEIRA',
  'TRES_LAGOAS',
  'MORUMBI',
];

const FIRST_NAMES = [
  'Maria', 'João', 'Ana', 'Carlos', 'Fernanda', 'Lucas', 'Juliana', 'Rafael',
  'Camila', 'Bruno', 'Patrícia', 'Diego', 'Mariana', 'Felipe', 'Beatriz',
  'Rodrigo', 'Larissa', 'Gustavo', 'Amanda', 'Thiago', 'Gabriela', 'Mateus',
  'Letícia', 'Vinícius', 'Renata',
];

const LAST_NAMES = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Pereira', 'Costa', 'Rodrigues',
  'Almeida', 'Nascimento', 'Lima', 'Araújo', 'Fernandes', 'Carvalho', 'Gomes',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${data.error || data.message || JSON.stringify(data)}`);
  }
  return data;
}

function pickRandom(arr, idx) {
  return arr[idx % arr.length];
}

async function runSimulation() {
  console.log('=== INICIANDO SIMULACAO MULTI-USUARIO BIKAPP (FOZ DO IGUACU) ===');

  const health = await api('GET', '/health');
  console.log(`Servidor online: ${health.service} | Cidade: ${health.city}`);

  // ONDA 1: Cadastro de 15 Ciclistas Aprovados com Chave Pix e Posicao GPS
  console.log('\n[ONDA 1/4] Cadastrando 15 ciclistas e atualizando telemetria GPS...');
  const couriers = [];
  for (let i = 1; i <= 15; i += 1) {
    const id = `bike-sim-${String(i).padStart(2, '0')}`;
    const name = `${pickRandom(FIRST_NAMES, i + 3)} ${pickRandom(LAST_NAMES, i * 2)} (Bike #${i})`;
    const res = await api('POST', '/api/couriers', {
      id,
      name,
      phone: `(45) 99800-${String(1000 + i)}`,
      pixKey: `ciclista${i}.foz@pix.bikapp`,
    });
    couriers.push(res.courier);

    const latOffset = ((i % 7) - 3) * 0.0042;
    const lngOffset = ((i % 5) - 2) * 0.0045;
    await api('POST', '/api/location', {
      courierId: id,
      name,
      lat: Number((-25.5478 + latOffset).toFixed(5)),
      lng: Number((-54.5882 + lngOffset).toFixed(5)),
      accuracy: 8,
    });
  }
  console.log(`-> ${couriers.length} ciclistas ativos e posicionados no mapa.`);
  await sleep(1200);

  // ONDA 2: Cadastro de 25 Clientes em Diversos Bairros
  console.log('\n[ONDA 2/4] Cadastrando 25 clientes em bairros de Foz do Iguacu...');
  const customers = [];
  for (let i = 1; i <= 25; i += 1) {
    const id = `cust-sim-${String(i).padStart(2, '0')}`;
    const name = `${pickRandom(FIRST_NAMES, i)} ${pickRandom(LAST_NAMES, i + 5)}`;
    const neighborhood = pickRandom(NEIGHBORHOODS, i);
    const res = await api('POST', '/api/customers', {
      id,
      name,
      phone: `(45) 99700-${String(2000 + i)}`,
      neighborhood,
      address: `Rua Teste Operacional, ${100 + i * 12}`,
    });
    customers.push(res.customer);
  }
  console.log(`-> ${customers.length} clientes cadastrados.`);
  await sleep(1200);

  // ONDA 3: Fluxo Completo de 30 Entregas Concluidas (Gera Fundos, Extratos e Ranking Top 50)
  console.log('\n[ONDA 3/4] Executando 30 entregas completas (Loja -> Ciclista -> Entrega -> Avaliacao 5 estrelas)...');
  const merchantsData = await api('GET', '/api/merchants');
  const merchants = (merchantsData.merchants || []).filter((m) => m.approved !== false);
  const productsData = await api('GET', '/api/products');
  const products = (productsData.products || []).filter((p) => p.active !== false);

  for (let i = 0; i < 30; i += 1) {
    const customer = pickRandom(customers, i);
    const merchant = pickRandom(merchants, i);
    const courier = pickRandom(couriers, i % 10);
    const merchantProducts = products.filter((p) => p.merchantId === merchant.id);
    const chosenProd = merchantProducts[0] || products[0];

    const created = await api('POST', '/api/orders', {
      originChannel: i % 3 === 0 ? 'BALCAO_LOJISTA' : 'APP_CLIENTE',
      customerId: customer.id,
      customerName: customer.name,
      customerAddress: customer.address,
      merchantId: merchant.id,
      category: chosenProd?.category || merchant.category,
      itemsSummary: chosenProd ? `1x ${chosenProd.name}` : 'Kit Leve Padrao',
      distanceKm: Number((1.2 + (i % 5) * 0.5).toFixed(2)),
      weightKg: Number(chosenProd?.weightKg || 0.8),
      orderValue: Number(chosenProd?.priceBRL || 39.9),
    });

    const orderId = created.order.id;

    if (created.order.status === 'AGUARDANDO_CONFIRMACAO_LOJA') {
      await api('POST', `/api/orders/${orderId}/confirm-store`);
    }

    await api('POST', `/api/orders/${orderId}/stage`, {
      courierId: courier.id,
      stage: 'ACEITO_PELO_CICLISTA',
    });
    await api('POST', `/api/orders/${orderId}/stage`, {
      courierId: courier.id,
      stage: 'NO_LOCAL_COLETA',
    });
    await api('POST', `/api/orders/${orderId}/stage`, {
      courierId: courier.id,
      stage: 'EM_ROTA_ENTREGA',
    });
    await api('POST', `/api/orders/${orderId}/complete`, {
      courierId: courier.id,
      onTime: true,
      fiveStar: false,
      peakOrRain: i % 4 === 0,
    });
    await api('POST', `/api/orders/${orderId}/rate`, {
      stars: i % 6 === 0 ? 4 : 5,
    });

    if ((i + 1) % 10 === 0) {
      console.log(`-> ${i + 1}/30 entregas concluidas...`);
      await sleep(900);
    }
  }

  // ONDA 4: Cenarios Vivos em Andamento + 1 Protocolo SOS Ativo para Inspecao Visual
  console.log('\n[ONDA 4/4] Gerando corridas vivas e 1 incidente SOS em rota para inspecao nas 4 telas...');
  const mainMerchant = merchants[0];
  const secondaryMerchant = merchants[1] || merchants[0];

  // Pedido A: Aguardando confirmacao da loja (/painel)
  await api('POST', '/api/orders', {
    originChannel: 'APP_CLIENTE',
    customerId: customers[0].id,
    merchantId: mainMerchant.id,
    category: mainMerchant.category,
    itemsSummary: '1x Pedido Vivo Aguardando Loja',
    distanceKm: 1.6,
    weightKg: 0.5,
    orderValue: 45.0,
  });

  // Pedido B: Confirmado pela loja, aguardando ciclista aceitar (/app)
  const orderB = await api('POST', '/api/orders', {
    originChannel: 'APP_CLIENTE',
    customerId: customers[1].id,
    merchantId: mainMerchant.id,
    category: mainMerchant.category,
    itemsSummary: '1x Pedido Vivo Disponivel para Ciclista',
    distanceKm: 2.1,
    weightKg: 0.7,
    orderValue: 58.0,
  });
  await api('POST', `/api/orders/${orderB.order.id}/confirm-store`);

  // Pedido C: Em rota de entrega e acionando SOS Seguro (Carga Intacta -> Resgate 2x + Decisao Cliente)
  const orderSos = await api('POST', '/api/orders', {
    originChannel: 'APP_CLIENTE',
    customerId: customers[2].id,
    merchantId: secondaryMerchant.id,
    category: secondaryMerchant.category,
    itemsSummary: '1x Combo Lanche Express (Teste SOS em Rota)',
    distanceKm: 2.4,
    weightKg: 0.9,
    orderValue: 42.0,
  });
  await api('POST', `/api/orders/${orderSos.order.id}/confirm-store`);
  await api('POST', `/api/orders/${orderSos.order.id}/stage`, {
    courierId: couriers[0].id,
    stage: 'ACEITO_PELO_CICLISTA',
  });
  await api('POST', `/api/orders/${orderSos.order.id}/stage`, {
    courierId: couriers[0].id,
    stage: 'NO_LOCAL_COLETA',
  });
  await api('POST', `/api/orders/${orderSos.order.id}/stage`, {
    courierId: couriers[0].id,
    stage: 'EM_ROTA_ENTREGA',
  });

  const sosTriggered = await api('POST', '/api/sos', {
    courierId: couriers[0].id,
    courierName: couriers[0].name,
    reason: 'PANE MECANICA NA BIKE (CORRENTE)',
    cargoCondition: 'INTACTA',
    lat: -25.5312,
    lng: -54.5815,
  });

  const finalHealth = await api('GET', '/health');
  console.log('\n=== SIMULACAO CONCLUIDA COM SUCESSO ===');
  console.log('Resumo do Estado Atual:', JSON.stringify(finalHealth.counts));
  console.log('Saldos dos Fundos:', JSON.stringify(finalHealth.funds));
  console.log(`Protocolo SOS Ativo: ${sosTriggered.alert.id} | Cliente afetado: ${customers[2].name} (${customers[2].id})`);
}

runSimulation().catch((err) => {
  console.error('\n[ERRO NA SIMULACAO]:', err.message);
  process.exit(1);
});