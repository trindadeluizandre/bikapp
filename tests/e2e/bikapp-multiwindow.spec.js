const { test, expect } = require('@playwright/test');

test('Fluxo Multi-Janela Completo: Cliente -> Loja -> Ciclista 1 (SOS) -> Cliente (Resgate) -> Ciclista 2 (2x)', async ({ browser }) => {
    // 1. Cria 4 contextos isolados (cada janela com seu proprio localStorage)
    const clientContext = await browser.newContext({ viewport: { width: 430, height: 820 } });
    const merchantContext = await browser.newContext({ viewport: { width: 520, height: 820 } });
    const courier1Context = await browser.newContext({ viewport: { width: 410, height: 820 } });
    const courier2Context = await browser.newContext({ viewport: { width: 410, height: 820 } });

    const clientPage = await clientContext.newPage();
    const merchantPage = await merchantContext.newPage();
    const courier1Page = await courier1Context.newPage();
    const courier2Page = await courier2Context.newPage();

    // Garante dois ciclistas isolados para esta execucao E2E
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

    // 2. Abre as 4 aplicacoes simultaneamente
    await Promise.all([
        clientPage.goto('/cliente'),
        merchantPage.goto('/painel'),
        courier1Page.goto('/app'),
        courier2Page.goto('/app'),
    ]);

    // Configura o Ciclista 1 na Janela 3 pela aba Cadastro / Pix
    await courier1Page.click('button[data-tab="profileTab"]');
    await courier1Page.selectOption('#courierSelector', primaryCourierId);
    await courier1Page.click('button[data-tab="ordersTab"]');

    // Configura o Ciclista 2 na Janela 4 pela aba Cadastro / Pix
    await courier2Page.click('button[data-tab="profileTab"]');
    await courier2Page.selectOption('#courierSelector', rescueCourierId);
    await courier2Page.click('button[data-tab="ordersTab"]');

    // 3. JANELA 1 (CLIENTE): Cadastra novo usuario e realiza pedido
    const uniqueCustomerName = `Cliente E2E ${Date.now().toString().slice(-4)}`;
    await clientPage.selectOption('#customerSelector', '__NEW__');
    await clientPage.fill('#custName', uniqueCustomerName);
    await clientPage.fill('#custPhone', '(45) 99911-2233');
    await clientPage.selectOption('#custNeighborhood', 'CENTRO');
    await clientPage.fill('#custAddress', 'Rua Marechal Deodoro, 900');
    await clientPage.click('#customerProfileForm button[type="submit"]');
    await expect(clientPage.locator('#customerProfileFeedback')).toContainText('salvo com sucesso');

    const submitOrderBtn = clientPage.locator('#submitClientOrderBtn');
    await expect(submitOrderBtn).toBeEnabled();
    await submitOrderBtn.click();
    await expect(clientPage.locator('#clientFeedback')).toContainText('enviado para');

    // 4. JANELA 2 (LOJISTA): Filtra pelo card exato deste cliente e confirma estoque
    const merchantOrderCard = merchantPage
        .locator('.order-item')
        .filter({ hasText: uniqueCustomerName });
    const confirmBtn = merchantOrderCard.getByRole('button', { name: /Confirmar Estoque/i });
    await expect(confirmBtn).toBeVisible({ timeout: 12000 });
    await confirmBtn.click();

    // 5. JANELA 3 (CICLISTA 1): Aceita a corrida especifica deste cliente e aciona SOS
    const courier1OrderCard = courier1Page
        .locator('.delivery-card')
        .filter({ hasText: uniqueCustomerName });
    await courier1OrderCard.getByRole('button', { name: /Etapa 1: Aceitar Corrida/i }).click({ timeout: 12000 });
    await courier1OrderCard.getByRole('button', { name: /Etapa 2: Cheguei na Coleta/i }).click({ timeout: 10000 });
    await courier1OrderCard.getByRole('button', { name: /Etapa 3: Sai para Entrega/i }).click({ timeout: 10000 });

    // Aciona SOS Seguro no mapa com encomenda intacta
    await courier1Page.locator('#sosBtn').click();
    await courier1Page.locator('#cargoIntactBtn').click();
    await courier1Page.getByRole('button', { name: /2\. Pane Mecânica na Bicicleta/i }).click();
    await expect(courier1Page.locator('#sosFeedbackBox')).toContainText('Protocolo');

    // 6. JANELA 1 (CLIENTE): Recebe aviso de contingencia e escolhe Aguardar Entregador de Resgate
    const waitRescueBtn = clientPage.getByRole('button', { name: /1\. Aguardar Entregador de Resgate/i });
    await expect(waitRescueBtn).toBeVisible({ timeout: 12000 });
    await waitRescueBtn.click();
    await expect(clientPage.locator('#clientOrdersList')).toContainText('AGUARDAR_RESGATE');

    // 7. JANELA 4 (CICLISTA 2): Aceita o Resgate Prioritario (2x + tempo) deste cliente e conclui
    const courier2OrderCard = courier2Page
        .locator('.delivery-card')
        .filter({ hasText: uniqueCustomerName });
    await courier2OrderCard.getByRole('button', { name: /Aceitar Resgate Prioritário/i }).click({ timeout: 12000 });
    await courier2OrderCard.getByRole('button', { name: /Pacote Resgatado/i }).click({ timeout: 10000 });
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
    const clientContext = await browser.newContext({ viewport: { width: 430, height: 820 } });
    const merchantContext = await browser.newContext({ viewport: { width: 520, height: 820 } });
    const courier1Context = await browser.newContext({ viewport: { width: 410, height: 820 } });
    const courier2Context = await browser.newContext({ viewport: { width: 410, height: 820 } });

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

    // 1. Cliente cadastra perfil e envia pedido
    const uniqueCustomerName = `Cliente Recompra ${Date.now().toString().slice(-4)}`;
    await clientPage.selectOption('#customerSelector', '__NEW__');
    await clientPage.fill('#custName', uniqueCustomerName);
    await clientPage.fill('#custPhone', '(45) 99944-5566');
    await clientPage.selectOption('#custNeighborhood', 'CENTRO');
    await clientPage.fill('#custAddress', 'Av. Brasil, 1200');
    await clientPage.click('#customerProfileForm button[type="submit"]');
    await expect(clientPage.locator('#customerProfileFeedback')).toContainText('salvo com sucesso');

    const submitOrderBtn = clientPage.locator('#submitClientOrderBtn');
    await expect(submitOrderBtn).toBeEnabled();
    await submitOrderBtn.click();
    await expect(clientPage.locator('#clientFeedback')).toContainText('enviado para');

    // 2. Loja confirma pedido original
    const merchantOrderCard = merchantPage
        .locator('.order-item')
        .filter({ hasText: uniqueCustomerName });
    const confirmOriginalBtn = merchantOrderCard.getByRole('button', { name: /Confirmar Estoque/i });
    await expect(confirmOriginalBtn).toBeVisible({ timeout: 12000 });
    await confirmOriginalBtn.click();

    // 3. Ciclista 1 inicia entrega e aciona SOS com carga DANIFICADA
    const courier1OrderCard = courier1Page
        .locator('.delivery-card')
        .filter({ hasText: uniqueCustomerName });
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

    // 5. Loja confirma o novo pedido de reposicao gerado pelo seguro
    const confirmReplacementBtn = merchantOrderCard.getByRole('button', { name: /Confirmar Estoque/i });
    await expect(confirmReplacementBtn).toBeVisible({ timeout: 12000 });
    await confirmReplacementBtn.click();

    // 6. Ciclista 2 aceita e conclui a entrega de reposicao
    const courier2OrderCard = courier2Page
        .locator('.delivery-card')
        .filter({ hasText: uniqueCustomerName });
    await courier2OrderCard.getByRole('button', { name: /Etapa 1: Aceitar Corrida/i }).click({ timeout: 12000 });
    await courier2OrderCard.getByRole('button', { name: /Etapa 2: Cheguei na Coleta/i }).click({ timeout: 10000 });
    await courier2OrderCard.getByRole('button', { name: /Etapa 3: Sai para Entrega/i }).click({ timeout: 10000 });
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