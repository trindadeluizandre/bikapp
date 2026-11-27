const { test, expect } = require('@playwright/test');

test('Fluxo Multi-Janela Completo: Cliente -> Loja -> Ciclista 1 (SOS) -> Cliente (Resgate) -> Ciclista 2 (2x)', async ({ browser }) => {
    const geoOpts = { geolocation: { latitude: -25.5427, longitude: -54.5827 }, permissions: ['geolocation'] };
    const clientContext = await browser.newContext({ viewport: { width: 430, height: 820 }, ...geoOpts });
    const merchantContext = await browser.newContext({ viewport: { width: 520, height: 820 }, ...geoOpts });
    const courier1Context = await browser.newContext({ viewport: { width: 410, height: 820 }, ...geoOpts });
    const courier2Context = await browser.newContext({ viewport: { width: 410, height: 820 }, ...geoOpts });

    const clientPage = await clientContext.newPage();
    const merchantPage = await merchantContext.newPage();
    const courier1Page = await courier1Context.newPage();
    const courier2Page = await courier2Context.newPage();

    const stamp = Date.now();
    const primaryCourierId = `bike-primario-${stamp}`;
    const rescueCourierId = `bike-resgate-${stamp}`;

    await clientPage.request.post('/api/couriers', {
        data: {
            id: primaryCourierId,
            name: 'Ciclista Primario E2E',
            phone: '(45) 99977-1122',
            pixKey: 'primario.e2e@pix.bikapp',
        },
    });

    await clientPage.request.post('/api/couriers', {
        data: {
            id: rescueCourierId,
            name: 'Carlos Resgate Bike',
            phone: '(45) 99988-7766',
            pixKey: 'carlos.resgate@pix.bikapp',
        },
    });

    await Promise.all([
        clientPage.goto('/cliente'),
        merchantPage.goto('/painel'),
        courier1Page.goto('/app'),
        courier2Page.goto('/app'),
    ]);

    await courier1Page.click('button[data-tab="profileTab"]');
    await courier1Page.selectOption('#courierSelector', primaryCourierId);
    await courier1Page.click('button[data-tab="ordersTab"]');

    await courier2Page.click('button[data-tab="profileTab"]');
    await courier2Page.selectOption('#courierSelector', rescueCourierId);
    await courier2Page.click('button[data-tab="ordersTab"]');

    // 3. JANELA 1 (CLIENTE): Cadastra novo usuario com CPF (ultimos 4 digitos: 8901) e realiza pedido
    const uniqueFirstName = `E2E${Date.now().toString().slice(-4)}`;
    const uniqueCustomerName = `${uniqueFirstName} Silva`;
    await clientPage.selectOption('#customerSelector', '__NEW__');
    await clientPage.fill('#custName', uniqueCustomerName);
    await clientPage.fill('#custPhone', '(45) 99911-2233');
    await clientPage.fill('#custCpf', '123.456.789-01');
    await clientPage.selectOption('#custNeighborhood', 'CENTRO');
    await clientPage.fill('#custAddress', 'Rua Marechal Deodoro, 900');
    await clientPage.click('#customerProfileForm button[type="submit"]');
    await expect(clientPage.locator('#customerProfileFeedback')).toContainText('salvo com sucesso');

    const selectedMerchantId = await clientPage.locator('#clientMerchant').inputValue();
    await merchantPage.selectOption('#merchantSelector', selectedMerchantId);

    const submitOrderBtn = clientPage.locator('#submitClientOrderBtn');
    await expect(submitOrderBtn).toBeEnabled();
    await submitOrderBtn.click();
    await expect(clientPage.locator('#clientFeedback')).toContainText('enviado para');

    // 4. JANELA 2 (LOJISTA): Etapa 1 (Iniciar Preparo) e Etapa 2 (Pedido Pronto no Balcao -> Chamar Ciclista)
    const merchantOrderCard = merchantPage
        .locator('.order-item')
        .filter({ hasText: uniqueFirstName });
    const confirmBtn = merchantOrderCard.getByRole('button', { name: /Confirmar Estoque e Iniciar Preparo/i });
    await expect(confirmBtn).toBeVisible({ timeout: 12000 });
    await confirmBtn.click();

    const readyBtn = merchantOrderCard.getByRole('button', { name: /Pedido Pronto no Balcão/i });
    await expect(readyBtn).toBeVisible({ timeout: 12000 });
    await readyBtn.click();

    // 5. JANELA 3 (CICLISTA 1): Aceita a corrida especifica deste cliente e aciona SOS
    const courier1OrderCard = courier1Page
        .locator('.delivery-card')
        .filter({ hasText: uniqueFirstName });
    await courier1OrderCard.getByRole('button', { name: /Etapa 1: Aceitar Corrida/i }).click({ timeout: 12000 });
    await courier1OrderCard.getByRole('button', { name: /Etapa 2: Cheguei na Coleta/i }).click({ timeout: 10000 });
    await courier1OrderCard.getByRole('button', { name: /Etapa 3: Sai para Entrega/i }).click({ timeout: 10000 });

    await courier1Page.locator('#sosBtn').click();
    await courier1Page.locator('#cargoIntactBtn').click();
    await courier1Page.getByRole('button', { name: /2\. Pane Mecânica na Bicicleta/i }).click();
    await expect(courier1Page.locator('#sosFeedbackBox')).toContainText('Protocolo');

    // 6. JANELA 1 (CLIENTE): Recebe aviso de contingencia e escolhe Aguardar Entregador de Resgate
    const waitRescueBtn = clientPage.getByRole('button', { name: /1\. Aguardar Entregador de Resgate/i });
    await expect(waitRescueBtn).toBeVisible({ timeout: 12000 });
    await waitRescueBtn.click();
    await expect(clientPage.locator('#clientOrdersList')).toContainText('AGUARDAR_RESGATE');

    // 7. JANELA 4 (CICLISTA 2): Aceita o Resgate Prioritario (2x + tempo), informa senha CPF (8901) e conclui
    const courier2OrderCard = courier2Page
        .locator('.delivery-card')
        .filter({ hasText: uniqueFirstName });
    await courier2OrderCard.getByRole('button', { name: /Aceitar Resgate Prioritário/i }).click({ timeout: 12000 });
    await courier2OrderCard.getByRole('button', { name: /Pacote Resgatado/i }).click({ timeout: 10000 });

    const pinInput2 = courier2OrderCard.locator('input[placeholder="4 dígitos CPF"]');
    await expect(pinInput2).toBeVisible({ timeout: 10000 });
    await pinInput2.fill('8901');
    await courier2OrderCard.getByRole('button', { name: /Etapa 4: Concluir Entrega/i }).click({ timeout: 10000 });

    // 8. JANELA 1 (CLIENTE): Valida entrega concluida e envia avaliacao 5 estrelas
    const rate5Btn = clientPage.getByRole('button', { name: /5 Estrelas/i }).first();
    await expect(rate5Btn).toBeVisible({ timeout: 12000 });
    await rate5Btn.click();
    await expect(clientPage.locator('#clientOrdersList')).toContainText('5/5 estrelas');

    await Promise.all([
        clientContext.close(),
        merchantContext.close(),
        courier1Context.close(),
        courier2Context.close(),
    ]);
});

test('Fluxo Multi-Janela Contingência: Carga Danificada -> Recompra Segurada -> Reposição Loja -> Entrega Ciclista 2', async ({ browser }) => {
    const geoOpts = { geolocation: { latitude: -25.5427, longitude: -54.5827 }, permissions: ['geolocation'] };
    const clientContext = await browser.newContext({ viewport: { width: 430, height: 820 }, ...geoOpts });
    const merchantContext = await browser.newContext({ viewport: { width: 520, height: 820 }, ...geoOpts });
    const courier1Context = await browser.newContext({ viewport: { width: 410, height: 820 }, ...geoOpts });
    const courier2Context = await browser.newContext({ viewport: { width: 410, height: 820 }, ...geoOpts });

    const clientPage = await clientContext.newPage();
    const merchantPage = await merchantContext.newPage();
    const courier1Page = await courier1Context.newPage();
    const courier2Page = await courier2Context.newPage();

    const stamp = Date.now();
    const primaryCourierId = `bike-danif-1-${stamp}`;
    const replacementCourierId = `bike-danif-2-${stamp}`;

    await clientPage.request.post('/api/couriers', {
        data: {
            id: primaryCourierId,
            name: 'Ciclista Avaria E2E',
            phone: '(45) 99966-1100',
            pixKey: 'avaria.e2e@pix.bikapp',
        },
    });

    await clientPage.request.post('/api/couriers', {
        data: {
            id: replacementCourierId,
            name: 'Ciclista Reposicao E2E',
            phone: '(45) 99966-2200',
            pixKey: 'reposicao.e2e@pix.bikapp',
        },
    });

    await Promise.all([
        clientPage.goto('/cliente'),
        merchantPage.goto('/painel'),
        courier1Page.goto('/app'),
        courier2Page.goto('/app'),
    ]);

    await courier1Page.click('button[data-tab="profileTab"]');
    await courier1Page.selectOption('#courierSelector', primaryCourierId);
    await courier1Page.click('button[data-tab="ordersTab"]');

    await courier2Page.click('button[data-tab="profileTab"]');
    await courier2Page.selectOption('#courierSelector', replacementCourierId);
    await courier2Page.click('button[data-tab="ordersTab"]');

    // 1. Cliente cadastra perfil com CPF (ultimos 4 digitos: 2100) e envia pedido
    const uniqueFirstName = `Rec${Date.now().toString().slice(-4)}`;
    const uniqueCustomerName = `${uniqueFirstName} Souza`;
    await clientPage.selectOption('#customerSelector', '__NEW__');
    await clientPage.fill('#custName', uniqueCustomerName);
    await clientPage.fill('#custPhone', '(45) 99944-5566');
    await clientPage.fill('#custCpf', '987.654.321-00');
    await clientPage.selectOption('#custNeighborhood', 'CENTRO');
    await clientPage.fill('#custAddress', 'Av. Brasil, 1200');
    await clientPage.click('#customerProfileForm button[type="submit"]');
    await expect(clientPage.locator('#customerProfileFeedback')).toContainText('salvo com sucesso');

    const selectedMerchantId = await clientPage.locator('#clientMerchant').inputValue();
    await merchantPage.selectOption('#merchantSelector', selectedMerchantId);

    const submitOrderBtn = clientPage.locator('#submitClientOrderBtn');
    await expect(submitOrderBtn).toBeEnabled();
    await submitOrderBtn.click();
    await expect(clientPage.locator('#clientFeedback')).toContainText('enviado para');

    // 2. Loja confirma pedido original em 2 etapas
    const merchantOrderCard = merchantPage
        .locator('.order-item')
        .filter({ hasText: uniqueFirstName });
    const confirmOriginalBtn = merchantOrderCard.getByRole('button', { name: /Confirmar Estoque e Iniciar Preparo/i });
    await expect(confirmOriginalBtn).toBeVisible({ timeout: 12000 });
    await confirmOriginalBtn.click();

    const readyOriginalBtn = merchantOrderCard.getByRole('button', { name: /Pedido Pronto no Balcão/i });
    await expect(readyOriginalBtn).toBeVisible({ timeout: 12000 });
    await readyOriginalBtn.click();

    // 3. Ciclista 1 inicia entrega e aciona SOS com carga DANIFICADA
    const courier1OrderCard = courier1Page
        .locator('.delivery-card')
        .filter({ hasText: uniqueFirstName });
    await courier1OrderCard.getByRole('button', { name: /Etapa 1: Aceitar Corrida/i }).click({ timeout: 12000 });
    await courier1OrderCard.getByRole('button', { name: /Etapa 2: Cheguei na Coleta/i }).click({ timeout: 10000 });
    await courier1OrderCard.getByRole('button', { name: /Etapa 3: Sai para Entrega/i }).click({ timeout: 10000 });

    await courier1Page.locator('#sosBtn').click();
    const damagedBtn = courier1Page.locator('#cargoDamagedBtn').or(
        courier1Page.getByRole('button', { name: /Danificada/i })
    ).first();
    await damagedBtn.click();
    await courier1Page.getByRole('button', { name: /2\. Pane Mecânica na Bicicleta/i }).click();
    await expect(courier1Page.locator('#sosFeedbackBox')).toContainText('Protocolo');

    // 4. Cliente valida ausencia do resgate fisico e escolhe Recompra Segurada
    await expect(
        clientPage.getByRole('button', { name: /1\. Aguardar Entregador de Resgate/i })
    ).toHaveCount(0, { timeout: 12000 });

    const repurchaseBtn = clientPage.getByRole('button', { name: /2\. Refazer Mesmo Pedido na Loja/i });
    await expect(repurchaseBtn).toBeVisible({ timeout: 12000 });
    await repurchaseBtn.click();

    await expect(clientPage.locator('#clientOrdersList')).toContainText('RECOMPRA_SEGURADA');
    await expect(clientPage.locator('#clientOrdersList')).toContainText('Novo pedido segurado:');

    // 5. Loja confirma o novo pedido de reposicao gerado pelo seguro em 2 etapas
    const confirmReplacementBtn = merchantOrderCard.getByRole('button', { name: /Confirmar Estoque e Iniciar Preparo/i });
    await expect(confirmReplacementBtn).toBeVisible({ timeout: 12000 });
    await confirmReplacementBtn.click();

    const readyReplacementBtn = merchantOrderCard.getByRole('button', { name: /Pedido Pronto no Balcão/i });
    await expect(readyReplacementBtn).toBeVisible({ timeout: 12000 });
    await readyReplacementBtn.click();

    // 6. Ciclista 2 aceita e conclui a entrega de reposicao
    const courier2OrderCard = courier2Page
        .locator('.delivery-card')
        .filter({ hasText: uniqueFirstName });
    await courier2OrderCard.getByRole('button', { name: /Etapa 1: Aceitar Corrida/i }).click({ timeout: 12000 });
    await courier2OrderCard.getByRole('button', { name: /Etapa 2: Cheguei na Coleta/i }).click({ timeout: 10000 });
    await courier2OrderCard.getByRole('button', { name: /Etapa 3: Sai para Entrega/i }).click({ timeout: 10000 });

    const replacementPinInput = courier2OrderCard.locator('input[placeholder="4 dígitos CPF"]');
    if (await replacementPinInput.isVisible()) {
        await replacementPinInput.fill('2100');
    }
    await courier2OrderCard.getByRole('button', { name: /Etapa 4: Concluir Entrega/i }).click({ timeout: 10000 });

    // 7. Cliente avalia entrega de reposicao com 5 estrelas
    const rate5Btn = clientPage.getByRole('button', { name: /5 Estrelas/i }).first();
    await expect(rate5Btn).toBeVisible({ timeout: 12000 });
    await rate5Btn.click();
    await expect(clientPage.locator('#clientOrdersList')).toContainText('5/5 estrelas');

    await Promise.all([
        clientContext.close(),
        merchantContext.close(),
        courier1Context.close(),
        courier2Context.close(),
    ]);
});