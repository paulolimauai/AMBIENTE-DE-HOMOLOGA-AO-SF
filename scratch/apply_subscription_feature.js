const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let code = fs.readFileSync(serverPath, 'utf8');

const isCRLF = code.includes('\r\n');
console.log('File CRLF mode:', isCRLF);

function norm(str) {
  if (isCRLF) {
    return str.replace(/(?<!\r)\n/g, '\r\n');
  }
  return str.replace(/\r\n/g, '\n');
}

function doReplace(target, replacement, stepName) {
  const nTarget = norm(target);
  const nReplacement = norm(replacement);
  if (!code.includes(nTarget)) {
    console.error(`ERRO no passo [${stepName}]: alvo não encontrado!`);
    process.exit(1);
  }
  code = code.replace(nTarget, nReplacement);
  console.log(`✓ ${stepName}`);
}

// 1. DATABASE MIGRATIONS
const migrationAnchor = `    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'last_ip')
    BEGIN
      ALTER TABLE usuarios ADD last_ip NVARCHAR(50) NULL;
    END;`;

const migrationReplacement = `    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'last_ip')
    BEGIN
      ALTER TABLE usuarios ADD last_ip NVARCHAR(50) NULL;
    END;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'trial_started_at')
    BEGIN
      ALTER TABLE usuarios ADD trial_started_at DATETIME2 NULL;
    END;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'subscription_plan')
    BEGIN
      ALTER TABLE usuarios ADD subscription_plan NVARCHAR(50) NULL;
    END;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'subscription_status')
    BEGIN
      ALTER TABLE usuarios ADD subscription_status NVARCHAR(50) DEFAULT 'trial';
    END;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'subscription_expires_at')
    BEGIN
      ALTER TABLE usuarios ADD subscription_expires_at DATETIME2 NULL;
    END;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'subscription_method')
    BEGIN
      ALTER TABLE usuarios ADD subscription_method NVARCHAR(50) NULL;
    END;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'subscription_payment_id')
    BEGIN
      ALTER TABLE usuarios ADD subscription_payment_id NVARCHAR(100) NULL;
    END;`;

doReplace(migrationAnchor, migrationReplacement, '1. Migrações de banco adicionadas');

// 2. INACTIVITY TIMEOUT
const timeoutAnchor = 'const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos (300.000 ms)';
const timeoutReplacement = 'const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos (checkout seguro)';
doReplace(timeoutAnchor, timeoutReplacement, '2. Timeout de inatividade estendido para 30 minutos');

// 3. CSS DO WIDGET DE TESTE E MODAL DE ASSINATURA
const cssAnchor = '/* Alinhamento Multidispositivo de Painéis e Cards */';
const cssToAdd = `/* ==================== WIDGET FLUTUANTE DE TESTE GRÁTIS (5 MINUTOS) ==================== */
.trial-dock-widget {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 99990;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.90);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1.5px solid rgba(16, 185, 129, 0.5);
  box-shadow: 0 16px 36px -6px rgba(0, 0, 0, 0.6), 0 0 24px rgba(16, 185, 129, 0.25);
  color: #FFFFFF;
  font-family: inherit;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  animation: slideUpDock 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  cursor: pointer;
}
.trial-dock-widget:hover {
  transform: translateY(-2px);
  border-color: #10B981;
  box-shadow: 0 20px 42px -6px rgba(0, 0, 0, 0.7), 0 0 32px rgba(16, 185, 129, 0.4);
}
.trial-dock-widget.trial-dock-urgent {
  border-color: rgba(245, 158, 11, 0.85);
  box-shadow: 0 16px 36px -6px rgba(0, 0, 0, 0.6), 0 0 30px rgba(245, 158, 11, 0.45);
  animation: pulseUrgent 1.8s infinite;
}
@keyframes pulseUrgent {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.03); }
}
@keyframes slideUpDock {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
.trial-dock-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(16, 185, 129, 0.2);
  color: #10B981;
  font-size: 14px;
}
.trial-dock-urgent .trial-dock-icon {
  background: rgba(245, 158, 11, 0.2);
  color: #F59E0B;
}
.trial-dock-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.trial-dock-title {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94A3B8;
  font-weight: 800;
}
.trial-dock-time {
  font-size: 15px;
  font-weight: 900;
  color: #34D399;
  letter-spacing: 0.02em;
}
.trial-dock-urgent .trial-dock-time {
  color: #FBBF24;
}
.trial-dock-btn {
  padding: 6px 14px;
  border-radius: 999px;
  background: linear-gradient(135deg, #10B981 0%, #059669 100%);
  color: #FFFFFF !important;
  font-size: 12px;
  font-weight: 800;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);
  transition: all 0.2s ease;
  white-space: nowrap;
}
.trial-dock-btn:hover {
  filter: brightness(1.1);
  transform: scale(1.04);
}

/* Light Mode para o Dock */
body.light .trial-dock-widget {
  background: #FFFFFF !important;
  border: 1.5px solid #059669 !important;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.12), 0 0 20px rgba(16, 185, 129, 0.2) !important;
  color: #000000 !important;
}
body.light .trial-dock-title {
  color: #000000 !important;
}
body.light .trial-dock-time {
  color: #047857 !important;
}

/* ==================== MODAL DE ASSINATURA E PAYWALL (4K GLASS) ==================== */
.sub-paywall-overlay {
  position: fixed !important;
  inset: 0 !important;
  z-index: 999999 !important;
  background: rgba(4, 7, 15, 0.88) !important;
  backdrop-filter: blur(28px) saturate(200%) !important;
  -webkit-backdrop-filter: blur(28px) saturate(200%) !important;
  display: none;
  align-items: center !important;
  justify-content: center !important;
  padding: 20px !important;
  overflow-y: auto !important;
  animation: fadeInModal 0.25s ease forwards;
}
.sub-paywall-modal {
  position: relative !important;
  width: 100% !important;
  max-width: 820px !important;
  max-height: 94vh !important;
  overflow-y: auto !important;
  background: linear-gradient(145deg, rgba(20, 27, 45, 0.96) 0%, rgba(10, 15, 30, 0.98) 100%) !important;
  border: 1.5px solid rgba(255, 255, 255, 0.16) !important;
  border-radius: 28px !important;
  box-shadow: 0 40px 100px -15px rgba(0, 0, 0, 0.9), 0 0 60px rgba(16, 185, 129, 0.18), inset 0 1px 1px rgba(255, 255, 255, 0.3) !important;
  padding: 34px 38px !important;
  box-sizing: border-box !important;
  animation: popIn4k 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.sub-paywall-modal::-webkit-scrollbar {
  width: 6px;
}
.sub-paywall-modal::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

/* Light Mode para Modal */
body.light .sub-paywall-modal {
  background: #FFFFFF !important;
  border: 1.5px solid #CBD5E1 !important;
  box-shadow: 0 35px 80px rgba(15, 23, 42, 0.25), 0 0 40px rgba(16, 185, 129, 0.15) !important;
  color: #000000 !important;
}
body.light .sub-paywall-modal h1,
body.light .sub-paywall-modal h2,
body.light .sub-paywall-modal h3,
body.light .sub-paywall-modal h4,
body.light .sub-paywall-modal p,
body.light .sub-paywall-modal span,
body.light .sub-paywall-modal label,
body.light .sub-paywall-modal div {
  color: #000000 !important;
}

/* Plan Selection Cards */
.sub-plans-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 20px 0 24px 0;
}
@media (max-width: 680px) {
  .sub-plans-grid {
    grid-template-columns: 1fr;
  }
}
.sub-plan-card {
  position: relative;
  border-radius: 20px;
  padding: 22px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.04);
  border: 2px solid rgba(255, 255, 255, 0.12);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.sub-plan-card:hover {
  border-color: rgba(16, 185, 129, 0.5);
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.06);
}
.sub-plan-card.active {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(5, 150, 105, 0.08) 100%);
  border-color: #10B981 !important;
  box-shadow: 0 12px 30px -6px rgba(16, 185, 129, 0.35), inset 0 0 20px rgba(16, 185, 129, 0.1);
}
body.light .sub-plan-card {
  background: #F8FAFC !important;
  border: 2px solid #E2E8F0 !important;
}
body.light .sub-plan-card.active {
  background: #F0FDF4 !important;
  border-color: #059669 !important;
  box-shadow: 0 10px 25px rgba(5, 150, 105, 0.15) !important;
}

.sub-plan-badge-highlight {
  position: absolute;
  top: -12px;
  right: 18px;
  background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
  color: #FFFFFF !important;
  font-size: 10.5px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 12px;
  border-radius: 999px;
  box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4);
}

.sub-plan-title {
  font-size: 17px;
  font-weight: 800;
  margin: 0 0 6px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sub-plan-price {
  font-size: 32px;
  font-weight: 900;
  color: #10B981;
  letter-spacing: -0.02em;
  margin: 8px 0;
}
.sub-plan-period {
  font-size: 13px;
  font-weight: 600;
  color: #94A3B8;
}
body.light .sub-plan-price {
  color: #047857 !important;
}
body.light .sub-plan-period {
  color: #000000 !important;
}

/* Payment Method Tabs */
.sub-payment-tabs {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 12px;
}
body.light .sub-payment-tabs {
  border-bottom-color: #E2E8F0 !important;
}
.sub-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.05);
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  color: #CBD5E1;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}
.sub-tab-btn:hover {
  background: rgba(255, 255, 255, 0.09);
  color: #FFFFFF;
}
.sub-tab-btn.active {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.15) 100%);
  border-color: #10B981;
  color: #34D399;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.25);
}
body.light .sub-tab-btn {
  background: #F1F5F9 !important;
  border-color: #CBD5E1 !important;
  color: #000000 !important;
}
body.light .sub-tab-btn.active {
  background: #DCFCE7 !important;
  border-color: #059669 !important;
  color: #047857 !important;
}

/* Input Fields inside Modal */
.sub-field-group {
  margin-bottom: 14px;
}
.sub-field-label {
  display: block;
  font-size: 11.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94A3B8;
  margin-bottom: 6px;
}
body.light .sub-field-label {
  color: #000000 !important;
}
.sub-field-input {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1.5px solid rgba(255, 255, 255, 0.12);
  color: #FFFFFF;
  font-size: 14px;
  font-weight: 600;
  box-sizing: border-box;
  transition: all 0.2s ease;
}
.sub-field-input:focus {
  outline: none;
  border-color: #10B981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
}
body.light .sub-field-input {
  background: #FFFFFF !important;
  border: 1.5px solid #CBD5E1 !important;
  color: #000000 !important;
}
body.light .sub-field-input:focus {
  border-color: #059669 !important;
}

/* Primary Pay Button */
.sub-pay-action-btn {
  width: 100%;
  height: 52px;
  border-radius: 16px;
  background: linear-gradient(135deg, #10B981 0%, #059669 50%, #047857 100%);
  color: #FFFFFF !important;
  font-size: 15.5px;
  font-weight: 900;
  letter-spacing: -0.01em;
  border: 1px solid rgba(255, 255, 255, 0.25);
  cursor: pointer;
  box-shadow: 0 12px 32px -4px rgba(16, 185, 129, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  margin-top: 20px;
}
.sub-pay-action-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 40px -4px rgba(16, 185, 129, 0.65);
  filter: brightness(1.05);
}

${cssAnchor}`;

doReplace(cssAnchor, cssToAdd, '3. Estilos CSS Cyber Glass & Modo Claro injetados');

// 4. OVERLAYS HTML: DOCK FLUTUANTE E MODAL DE ASSINATURA
const overlaysAnchor = '<!-- OVERLAY 4K: EXIBIÇÃO DA SENHA TEMPORÁRIA EM TELA -->';
const overlaysToAdd = `<!-- WIDGET FLUTUANTE DE TESTE GRÁTIS (5 MINUTOS) -->
<div class="trial-dock-widget" id="trialDockWidget" style="display:none;" onclick="window.openSubscriptionPaywall(false)" title="Clique para assinar um plano">
  <div class="trial-dock-icon">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>
  </div>
  <div class="trial-dock-text">
    <span class="trial-dock-title">Período Gratuito</span>
    <span class="trial-dock-time" id="trialDockTime">05:00</span>
  </div>
  <button type="button" class="trial-dock-btn" onclick="event.stopPropagation(); window.openSubscriptionPaywall(false);">
    Assinar Plano
  </button>
</div>

<!-- MODAL DE ASSINATURA E PAYWALL MANDATÓRIO -->
<div class="sub-paywall-overlay" id="nexusSubscriptionModal" role="dialog" aria-modal="true">
  <div class="sub-paywall-modal">
    <!-- Cabeçalho do Modal -->
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
      <div style="display:flex; align-items:center; gap:14px;">
        <div style="width:48px; height:48px; border-radius:14px; background:linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(5, 150, 105, 0.15)); border:1.5px solid rgba(16, 185, 129, 0.5); display:flex; align-items:center; justify-content:center; font-size:24px;">
          🔒
        </div>
        <div>
          <h2 style="font-size:22px; font-weight:900; margin:0; letter-spacing:-0.02em; color:#FFFFFF;" id="subModalTitle">
            Assinatura Nexus Financeiro Hub
          </h2>
          <p style="font-size:13px; color:#94A3B8; margin:4px 0 0 0;" id="subModalSubtitle">
            Seu período de 5 minutos grátis encerrou. Escolha seu plano para continuar:
          </p>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <button type="button" id="subAdminBypassBtn" onclick="window.closeSubscriptionPaywall(true)" style="display:none; padding:6px 12px; border-radius:8px; background:rgba(245,158,11,0.18); border:1px solid rgba(245,158,11,0.4); color:#FBBF24; font-size:11.5px; font-weight:800; cursor:pointer;">
          Modo Admin: Ignorar
        </button>
        <button type="button" id="subModalCloseBtn" onclick="window.closeSubscriptionPaywall(false)" style="display:none; width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#CBD5E1; cursor:pointer; align-items:center; justify-content:center; font-size:18px; line-height:1;">
          ✕
        </button>
      </div>
    </div>

    <!-- Conteúdo Principal de Checkout -->
    <div id="subCheckoutView">
      <!-- Grade dos 2 Planos -->
      <div class="sub-plans-grid">
        <!-- Plano Mensal (R$ 10,00) -->
        <div class="sub-plan-card active" id="subPlanCardMensal" onclick="window.selectSubPlan('mensal')">
          <div>
            <div class="sub-plan-title">
              <span>Plano Mensal</span>
              <span style="font-size:18px;">📅</span>
            </div>
            <p style="font-size:12.5px; color:#94A3B8; margin:0 0 10px 0;">Acesso completo a todas as ferramentas sem fidelidade.</p>
            <div class="sub-plan-price">
              R$ 10,00 <span class="sub-plan-period">/ mês</span>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#10B981; margin-top:10px;">
            <span>✓ Cancele quando quiser</span>
          </div>
        </div>

        <!-- Plano Anual (R$ 100,00) -->
        <div class="sub-plan-card" id="subPlanCardAnual" onclick="window.selectSubPlan('anual')">
          <div class="sub-plan-badge-highlight">★ Economize R$ 20,00</div>
          <div>
            <div class="sub-plan-title">
              <span>Plano Anual</span>
              <span style="font-size:18px;">👑</span>
            </div>
            <p style="font-size:12.5px; color:#94A3B8; margin:0 0 10px 0;">12 meses de acesso (equivale a apenas R$ 8,33/mês).</p>
            <div class="sub-plan-price">
              R$ 100,00 <span class="sub-plan-period">/ ano</span>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#F59E0B; margin-top:10px;">
            <span>✓ 2 Meses Grátis + Suporte VIP</span>
          </div>
        </div>
      </div>

      <!-- Abas de Formas de Pagamento -->
      <div style="margin-top:18px;">
        <span style="display:block; font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#94A3B8; margin-bottom:10px;">
          Forma de Pagamento
        </span>
        <div class="sub-payment-tabs">
          <button type="button" class="sub-tab-btn active" id="subTabPix" onclick="window.selectPaymentMethod('pix')">
            <span>💠</span> <span>Pix (Instantâneo)</span>
          </button>
          <button type="button" class="sub-tab-btn" id="subTabCredit" onclick="window.selectPaymentMethod('credit_card')">
            <span>💳</span> <span>Cartão de Crédito</span>
          </button>
          <button type="button" class="sub-tab-btn" id="subTabDebit" onclick="window.selectPaymentMethod('debit_card')">
            <span>💳</span> <span>Cartão de Débito</span>
          </button>
          <button type="button" class="sub-tab-btn" id="subTabBoleto" onclick="window.selectPaymentMethod('boleto')">
            <span>📄</span> <span>Boleto Bancário</span>
          </button>
        </div>
      </div>

      <!-- FORMULÁRIO: PIX -->
      <div id="subFormPix" style="display:block;">
        <div style="background:rgba(255,255,255,0.03); border:1.5px solid rgba(255,255,255,0.1); border-radius:18px; padding:22px; display:flex; flex-direction:column; align-items:center; text-align:center;">
          <div style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#10B981; margin-bottom:8px;">
            ✓ Liberação Imediata via Pix
          </div>
          <div style="font-size:14px; font-weight:700; color:#CBD5E1; margin-bottom:16px;">
            Valor a Pagar: <strong id="pixDisplayAmount" style="color:#10B981; font-size:20px;">R$ 10,00</strong>
          </div>

          <!-- QR Code Display -->
          <div style="background:#FFFFFF; padding:14px; border-radius:18px; box-shadow:0 8px 24px rgba(0,0,0,0.4); margin-bottom:16px;">
            <img id="subPixQrImg" src="" alt="QR Code Pix" style="width:200px; height:200px; display:block;" />
          </div>

          <!-- Código Pix Copia e Cola -->
          <div style="width:100%; max-width:540px; margin-bottom:14px;">
            <label class="sub-field-label" style="text-align:left;">Código Pix Copia e Cola</label>
            <div style="display:flex; gap:8px;">
              <input type="text" id="subPixCodeInput" readonly class="sub-field-input" style="font-size:12px; font-family:monospace;" />
              <button type="button" id="btnCopyPix" onclick="window.copyPixCodeToClipboard()" style="padding:0 18px; border-radius:12px; background:rgba(16,185,129,0.2); border:1.5px solid rgba(16,185,129,0.4); color:#34D399; font-weight:800; font-size:13px; cursor:pointer; white-space:nowrap;">
                📋 Copiar
              </button>
            </div>
          </div>

          <p style="font-size:12px; color:#94A3B8; margin:0 0 16px 0;">
            Abra o app do seu banco, escolha <strong>Pix Copia e Cola</strong> ou aponte a câmera para o QR Code acima.
          </p>

          <button type="button" class="sub-pay-action-btn" onclick="window.processSubscriptionPayment('pix')">
            <span>✅</span> <span>Já Realizei o Pagamento Pix / Ativar Agora</span>
          </button>
        </div>
      </div>

      <!-- FORMULÁRIO: CARTÃO DE CRÉDITO -->
      <div id="subFormCredit" style="display:none;">
        <div style="background:rgba(255,255,255,0.03); border:1.5px solid rgba(255,255,255,0.1); border-radius:18px; padding:22px;">
          <!-- Preview Cartão Holográfico -->
          <div style="max-width:380px; height:180px; margin:0 auto 20px; border-radius:18px; background:linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border:1.5px solid rgba(255,255,255,0.2); box-shadow:0 14px 35px rgba(0,0,0,0.6); padding:20px; box-sizing:border-box; display:flex; flex-direction:column; justify-content:space-between; position:relative; overflow:hidden;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:12px; font-weight:800; letter-spacing:0.08em; color:#94A3B8;">CARTÃO DE CRÉDITO</span>
              <span id="creditCardFlagBadge" style="font-size:14px; font-weight:900; color:#34D399;">VISA / MASTER</span>
            </div>
            <div id="creditCardNumberPreview" style="font-size:18px; font-weight:900; letter-spacing:0.12em; color:#FFFFFF; font-family:monospace;">
              •••• •••• •••• ••••
            </div>
            <div style="display:flex; justify-content:space-between; align-items:flex-end;">
              <div>
                <span style="font-size:9px; text-transform:uppercase; color:#94A3B8; display:block;">Titular</span>
                <span id="creditCardHolderPreview" style="font-size:13px; font-weight:800; color:#FFFFFF; text-transform:uppercase;">NOME COMPLETO</span>
              </div>
              <div style="text-align:right;">
                <span style="font-size:9px; text-transform:uppercase; color:#94A3B8; display:block;">Validade</span>
                <span id="creditCardExpiryPreview" style="font-size:13px; font-weight:800; color:#FFFFFF; font-family:monospace;">MM/AA</span>
              </div>
            </div>
          </div>

          <div class="sub-field-group">
            <label class="sub-field-label">Número do Cartão de Crédito</label>
            <input type="text" id="subCardNumber" maxlength="19" placeholder="0000 0000 0000 0000" class="sub-field-input" oninput="window.formatCardNumberInput(this)" />
          </div>

          <div class="sub-field-group">
            <label class="sub-field-label">Nome Impresso no Cartão</label>
            <input type="text" id="subCardHolder" placeholder="Nome como está no cartão" class="sub-field-input" oninput="document.getElementById('creditCardHolderPreview').textContent = this.value.toUpperCase() || 'NOME COMPLETO'" />
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="sub-field-group">
              <label class="sub-field-label">Validade (MM/AA)</label>
              <input type="text" id="subCardExpiry" maxlength="5" placeholder="MM/AA" class="sub-field-input" oninput="window.formatCardExpiryInput(this)" />
            </div>
            <div class="sub-field-group">
              <label class="sub-field-label">CVV (Cód. Segurança)</label>
              <input type="password" id="subCardCvv" maxlength="4" placeholder="123" class="sub-field-input" />
            </div>
          </div>

          <div class="sub-field-group">
            <label class="sub-field-label">Parcelamento</label>
            <select id="subCardInstallments" class="sub-field-input" style="height:44px;">
              <option value="1">1x de R$ 10,00 sem juros</option>
            </select>
          </div>

          <button type="button" class="sub-pay-action-btn" onclick="window.processSubscriptionPayment('credit_card')">
            <span>🔒</span> <span id="creditCardBtnLabel">Pagar R$ 10,00 com Cartão de Crédito</span>
          </button>
        </div>
      </div>

      <!-- FORMULÁRIO: CARTÃO DE DÉBITO -->
      <div id="subFormDebit" style="display:none;">
        <div style="background:rgba(255,255,255,0.03); border:1.5px solid rgba(255,255,255,0.1); border-radius:18px; padding:22px;">
          <div class="sub-field-group">
            <label class="sub-field-label">Número do Cartão de Débito</label>
            <input type="text" id="subDebitNumber" maxlength="19" placeholder="0000 0000 0000 0000" class="sub-field-input" oninput="window.formatCardNumberInput(this)" />
          </div>

          <div class="sub-field-group">
            <label class="sub-field-label">Nome do Titular da Conta</label>
            <input type="text" id="subDebitHolder" placeholder="Nome Completo" class="sub-field-input" />
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div class="sub-field-group">
              <label class="sub-field-label">Validade (MM/AA)</label>
              <input type="text" id="subDebitExpiry" maxlength="5" placeholder="MM/AA" class="sub-field-input" oninput="window.formatCardExpiryInput(this)" />
            </div>
            <div class="sub-field-group">
              <label class="sub-field-label">CVV</label>
              <input type="password" id="subDebitCvv" maxlength="4" placeholder="123" class="sub-field-input" />
            </div>
          </div>

          <div class="sub-field-group">
            <label class="sub-field-label">Banco Emissor do Cartão</label>
            <select id="subDebitBank" class="sub-field-input" style="height:44px;">
              <option value="nubank">Nubank</option>
              <option value="bb">Banco do Brasil</option>
              <option value="bradesco">Bradesco</option>
              <option value="itau">Itaú Unibanco</option>
              <option value="santander">Santander</option>
              <option value="caixa">Caixa Econômica Federal</option>
              <option value="inter">Banco Inter</option>
              <option value="c6">C6 Bank</option>
            </select>
          </div>

          <button type="button" class="sub-pay-action-btn" onclick="window.processSubscriptionPayment('debit_card')">
            <span>🔒</span> <span id="debitCardBtnLabel">Pagar R$ 10,00 com Débito Imediato</span>
          </button>
        </div>
      </div>

      <!-- FORMULÁRIO: BOLETO BANCÁRIO -->
      <div id="subFormBoleto" style="display:none;">
        <div style="background:rgba(255,255,255,0.03); border:1.5px solid rgba(255,255,255,0.1); border-radius:18px; padding:22px; text-align:center;">
          <div style="font-size:32px; margin-bottom:8px;">📄</div>
          <div style="font-size:14px; font-weight:700; color:#CBD5E1; margin-bottom:12px;">
            Boleto Bancário - Valor: <strong id="boletoDisplayAmount" style="color:#10B981; font-size:18px;">R$ 10,00</strong>
          </div>

          <div style="width:100%; max-width:540px; margin:0 auto 16px auto;">
            <label class="sub-field-label" style="text-align:left;">Linha Digitável do Boleto</label>
            <div style="display:flex; gap:8px;">
              <input type="text" id="subBoletoCodeInput" readonly value="34191.79001 01043.510047 91020.150008 8 98760000001000" class="sub-field-input" style="font-size:12px; font-family:monospace;" />
              <button type="button" onclick="window.copyBoletoCodeToClipboard()" style="padding:0 18px; border-radius:12px; background:rgba(16,185,129,0.2); border:1.5px solid rgba(16,185,129,0.4); color:#34D399; font-weight:800; font-size:13px; cursor:pointer; white-space:nowrap;">
                📋 Copiar
              </button>
            </div>
          </div>

          <!-- Código de Barras Estilizado -->
          <div style="display:flex; justify-content:center; gap:2px; height:48px; margin:16px auto; max-width:320px; opacity:0.85;">
            <span style="background:#fff; width:3px;"></span><span style="background:transparent; width:2px;"></span>
            <span style="background:#fff; width:4px;"></span><span style="background:transparent; width:1px;"></span>
            <span style="background:#fff; width:2px;"></span><span style="background:transparent; width:3px;"></span>
            <span style="background:#fff; width:5px;"></span><span style="background:transparent; width:2px;"></span>
            <span style="background:#fff; width:3px;"></span><span style="background:transparent; width:1px;"></span>
            <span style="background:#fff; width:6px;"></span><span style="background:transparent; width:3px;"></span>
            <span style="background:#fff; width:2px;"></span><span style="background:transparent; width:2px;"></span>
            <span style="background:#fff; width:4px;"></span><span style="background:transparent; width:1px;"></span>
            <span style="background:#fff; width:5px;"></span><span style="background:transparent; width:2px;"></span>
            <span style="background:#fff; width:3px;"></span><span style="background:transparent; width:3px;"></span>
            <span style="background:#fff; width:6px;"></span><span style="background:transparent; width:1px;"></span>
            <span style="background:#fff; width:2px;"></span><span style="background:transparent; width:2px;"></span>
            <span style="background:#fff; width:4px;"></span><span style="background:transparent; width:3px;"></span>
          </div>

          <p style="font-size:12px; color:#94A3B8; margin:0 0 16px 0;">
            Vencimento em 3 dias úteis. No ambiente de homologação, você pode confirmar e ativar imediatamente.
          </p>

          <button type="button" class="sub-pay-action-btn" onclick="window.processSubscriptionPayment('boleto')">
            <span>✅</span> <span>Confirmar Pagamento do Boleto (Homologação)</span>
          </button>
        </div>
      </div>
    </div>

    <!-- TELA DE SUCESSO DO PAGAMENTO -->
    <div id="subSuccessView" style="display:none; text-align:center; padding:30px 10px;">
      <div style="width:72px; height:72px; margin:0 auto 16px; border-radius:50%; background:radial-gradient(circle, rgba(16,185,129,0.3) 0%, rgba(5,150,105,0.15) 60%, rgba(0,0,0,0.4) 100%); border:2px solid #10B981; display:flex; align-items:center; justify-content:center; font-size:36px; box-shadow:0 0 35px rgba(16,185,129,0.4);">
        ✓
      </div>
      <div style="display:inline-flex; align-items:center; gap:6px; padding:4px 14px; border-radius:999px; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.4); color:#34D399; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:12px;">
        <span>Assinatura Ativa & Aprovada</span>
      </div>
      <h3 style="font-size:24px; font-weight:900; margin:0 0 8px 0; color:#FFFFFF;">
        Pagamento Confirmado com Sucesso!
      </h3>
      <p style="font-size:14px; color:#CBD5E1; margin:0 0 20px 0; max-width:500px; margin-left:auto; margin-right:auto; line-height:1.5;">
        Seu plano <strong id="subSuccessPlanName" style="color:#10B981;">Mensal</strong> foi ativado. O acesso total a todas as ferramentas financeiras do Nexus Hub está liberado!
      </p>

      <div style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); border-radius:16px; padding:16px; max-width:420px; margin:0 auto 24px auto; text-align:left;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px;">
          <span style="color:#94A3B8;">Comprovante / ID:</span>
          <strong id="subSuccessTxId" style="color:#FFFFFF; font-family:monospace;">-</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px;">
          <span style="color:#94A3B8;">Forma de Pagamento:</span>
          <strong id="subSuccessMethod" style="color:#FFFFFF;">-</strong>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:13px;">
          <span style="color:#94A3B8;">Válido até:</span>
          <strong id="subSuccessExpires" style="color:#34D399;">-</strong>
        </div>
      </div>

      <button type="button" class="sub-pay-action-btn" onclick="window.closeSubscriptionPaywall(true)" style="max-width:320px; margin:0 auto;">
        <span>🚀</span> <span>Começar a Usar Agora</span>
      </button>
    </div>
  </div>
</div>

${overlaysAnchor}`;

doReplace(overlaysAnchor, overlaysToAdd, '4. Overlays HTML do Dock e Modal injetados');

// 5. CLIENT-SIDE JAVASCRIPT ENGINE
const clientEngineAnchor = 'window.checkServerRegPasswordMatch = function() {';
const clientEngineToAdd = `/* ==================== Motor de Período Gratuito (5 Minutos) e Assinatura Mandatória ==================== */
window.__trialTimerInterval = null;
window.__trialRemainingSeconds = 300;
window.__selectedSubPlan = 'mensal';
window.__selectedPaymentMethod = 'pix';
window.__isPaywallLocked = false;

window.initTrialAndSubscription = async function() {
  if (!currentUser || !currentUser.email) return;

  try {
    const res = await fetch('/api/subscription/status?email=' + encodeURIComponent(currentUser.email));
    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        currentUser.subscription_status = data.status;
        currentUser.subscription_plan = data.subscription_plan;
        currentUser.subscription_expires_at = data.subscription_expires_at;
        currentUser.subscription_method = data.subscription_method;
        currentUser.trial_started_at = data.trial_started_at;
        window.__trialRemainingSeconds = data.remaining_seconds;

        try { saveToStorage('nexus_cached_user', currentUser); } catch(e){}

        if (data.is_subscribed) {
          window.hideTrialDockWidget();
          window.closeSubscriptionPaywall(true);
          return;
        }

        if (data.status === 'expired') {
          window.hideTrialDockWidget();
          window.openSubscriptionPaywall(true);
          return;
        }

        // Período de teste ativo (até 300s)
        window.startTrialCountdown(data.remaining_seconds);
      }
    }
  } catch(e) {
    console.warn('[ASSINATURA] Falha ao consultar status de assinatura:', e);
    window.startTrialCountdown(window.__trialRemainingSeconds || 300);
  }
};

window.startTrialCountdown = function(remainingSecs) {
  window.__trialRemainingSeconds = (typeof remainingSecs === 'number') ? remainingSecs : 300;

  if (window.__trialTimerInterval) {
    clearInterval(window.__trialTimerInterval);
    window.__trialTimerInterval = null;
  }

  window.showTrialDockWidget();
  window.updateTrialDisplay();

  window.__trialTimerInterval = setInterval(() => {
    window.__trialRemainingSeconds--;

    if (window.__trialRemainingSeconds <= 0) {
      clearInterval(window.__trialTimerInterval);
      window.__trialTimerInterval = null;
      window.__trialRemainingSeconds = 0;
      window.updateTrialDisplay();

      // Tempo esgotado: bloqueio mandatório do sistema
      window.hideTrialDockWidget();
      window.openSubscriptionPaywall(true);
      return;
    }

    window.updateTrialDisplay();
  }, 1000);
};

window.updateTrialDisplay = function() {
  const mins = Math.floor(Math.max(0, window.__trialRemainingSeconds) / 60);
  const secs = Math.max(0, window.__trialRemainingSeconds) % 60;
  const timeFormatted = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

  const labelEl = document.getElementById('trialDockTime');
  const widget = document.getElementById('trialDockWidget');
  if (labelEl) labelEl.textContent = timeFormatted;

  if (widget) {
    if (window.__trialRemainingSeconds <= 60) {
      widget.classList.add('trial-dock-urgent');
    } else {
      widget.classList.remove('trial-dock-urgent');
    }
  }
};

window.showTrialDockWidget = function() {
  const widget = document.getElementById('trialDockWidget');
  if (widget) widget.style.display = 'flex';
};

window.hideTrialDockWidget = function() {
  const widget = document.getElementById('trialDockWidget');
  if (widget) widget.style.display = 'none';
};

window.openSubscriptionPaywall = function(isLocked = false) {
  window.__isPaywallLocked = !!isLocked;
  const modal = document.getElementById('nexusSubscriptionModal');
  if (!modal) return;

  const closeBtn = document.getElementById('subModalCloseBtn');
  const adminBypass = document.getElementById('subAdminBypassBtn');
  const titleEl = document.getElementById('subModalTitle');
  const subEl = document.getElementById('subModalSubtitle');

  if (isLocked) {
    if (titleEl) titleEl.textContent = '🔒 Período Gratuito de 5 Minutos Encerrado!';
    if (subEl) subEl.textContent = 'Para continuar utilizando o sistema, selecione seu plano mensal ou anual:';
  } else {
    if (titleEl) titleEl.textContent = '⭐ Escolha seu Plano de Assinatura';
    if (subEl) subEl.textContent = 'Aproveite todos os recursos do Nexus Financeiro Hub com total segurança:';
  }

  if (closeBtn) {
    closeBtn.style.display = isLocked ? 'none' : 'flex';
  }

  if (adminBypass) {
    const isAdmin = currentUser && currentUser.role === 'Administrador';
    adminBypass.style.display = (isLocked && isAdmin) ? 'inline-block' : 'none';
  }

  // Reseta para tela de checkout se estava na tela de sucesso
  const checkoutView = document.getElementById('subCheckoutView');
  const successView = document.getElementById('subSuccessView');
  if (checkoutView) checkoutView.style.display = 'block';
  if (successView) successView.style.display = 'none';

  window.selectSubPlan(window.__selectedSubPlan || 'mensal');
  window.selectPaymentMethod(window.__selectedPaymentMethod || 'pix');

  modal.style.display = 'flex';
  modal.classList.add('show');
};

window.closeSubscriptionPaywall = function(force = false) {
  if (window.__isPaywallLocked && !force) {
    if (typeof showToast === 'function') {
      showToast('⚠️ Seu período de 5 minutos grátis encerrou. É necessário assinar um plano para continuar.');
    }
    return;
  }
  window.__isPaywallLocked = false;
  const modal = document.getElementById('nexusSubscriptionModal');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
};

window.selectSubPlan = function(plan) {
  window.__selectedSubPlan = plan;
  const cardMensal = document.getElementById('subPlanCardMensal');
  const cardAnual = document.getElementById('subPlanCardAnual');
  const pixDisplay = document.getElementById('pixDisplayAmount');
  const boletoDisplay = document.getElementById('boletoDisplayAmount');
  const creditBtnLabel = document.getElementById('creditCardBtnLabel');
  const debitBtnLabel = document.getElementById('debitCardBtnLabel');
  const installmentsSelect = document.getElementById('subCardInstallments');

  if (plan === 'anual') {
    if (cardAnual) cardAnual.classList.add('active');
    if (cardMensal) cardMensal.classList.remove('active');
    if (pixDisplay) pixDisplay.textContent = 'R$ 100,00';
    if (boletoDisplay) boletoDisplay.textContent = 'R$ 100,00';
    if (creditBtnLabel) creditBtnLabel.textContent = 'Pagar R$ 100,00 com Cartão de Crédito';
    if (debitBtnLabel) debitBtnLabel.textContent = 'Pagar R$ 100,00 com Débito Imediato';

    if (installmentsSelect) {
      installmentsSelect.innerHTML = '<option value="1">1x de R$ 100,00 sem juros</option>' +
        '<option value="2">2x de R$ 50,00 sem juros</option>' +
        '<option value="3">3x de R$ 33,33 sem juros</option>' +
        '<option value="6">6x de R$ 16,67 sem juros</option>' +
        '<option value="10">10x de R$ 10,00 sem juros</option>' +
        '<option value="12">12x de R$ 8,33 sem juros</option>';
    }
  } else {
    if (cardMensal) cardMensal.classList.add('active');
    if (cardAnual) cardAnual.classList.remove('active');
    if (pixDisplay) pixDisplay.textContent = 'R$ 10,00';
    if (boletoDisplay) boletoDisplay.textContent = 'R$ 10,00';
    if (creditBtnLabel) creditBtnLabel.textContent = 'Pagar R$ 10,00 com Cartão de Crédito';
    if (debitBtnLabel) debitBtnLabel.textContent = 'Pagar R$ 10,00 com Débito Imediato';

    if (installmentsSelect) {
      installmentsSelect.innerHTML = '<option value="1">1x de R$ 10,00 sem juros</option>';
    }
  }

  window.updatePixPayloadAndQr();
};

window.selectPaymentMethod = function(method) {
  window.__selectedPaymentMethod = method;
  const tabs = ['pix', 'credit_card', 'debit_card', 'boleto'];
  tabs.forEach(m => {
    const tabEl = document.getElementById(m === 'pix' ? 'subTabPix' : (m === 'credit_card' ? 'subTabCredit' : (m === 'debit_card' ? 'subTabDebit' : 'subTabBoleto')));
    const formEl = document.getElementById(m === 'pix' ? 'subFormPix' : (m === 'credit_card' ? 'subFormCredit' : (m === 'debit_card' ? 'subFormDebit' : 'subFormBoleto')));
    if (tabEl) {
      if (m === method) tabEl.classList.add('active');
      else tabEl.classList.remove('active');
    }
    if (formEl) {
      formEl.style.display = (m === method) ? 'block' : 'none';
    }
  });

  if (method === 'pix') {
    window.updatePixPayloadAndQr();
  }
};

window.updatePixPayloadAndQr = function() {
  const amount = (window.__selectedSubPlan === 'anual') ? '100.00' : '10.00';
  const rawKey = '04023326100'; // Chave Pix oficial
  const pixCode = '00020126580014BR.GOV.BCB.PIX011404023326100520400005303986540' + (amount === '100.00' ? '6100.00' : '510.00') + '5802BR5920NEXUS SOLUCOES FIN6007GOIANIA62070503***6304' + (amount === '100.00' ? 'E8B2' : 'D3F1');

  const inputEl = document.getElementById('subPixCodeInput');
  const imgEl = document.getElementById('subPixQrImg');
  if (inputEl) inputEl.value = pixCode;
  if (imgEl) {
    imgEl.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(pixCode);
  }
};

window.copyPixCodeToClipboard = function() {
  const inputEl = document.getElementById('subPixCodeInput');
  if (!inputEl) return;
  inputEl.select();
  inputEl.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(inputEl.value).then(() => {
    const btn = document.getElementById('btnCopyPix');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✓ Copiado!';
      btn.style.color = '#10B981';
      setTimeout(() => { btn.innerHTML = orig; btn.style.color = '#34D399'; }, 2500);
    }
    if (typeof showToast === 'function') showToast('✓ Código Pix copiado com sucesso! Cole no app do seu banco.');
  }).catch(() => {
    document.execCommand('copy');
    if (typeof showToast === 'function') showToast('✓ Código Pix copiado!');
  });
};

window.copyBoletoCodeToClipboard = function() {
  const inputEl = document.getElementById('subBoletoCodeInput');
  if (!inputEl) return;
  inputEl.select();
  navigator.clipboard.writeText(inputEl.value).then(() => {
    if (typeof showToast === 'function') showToast('✓ Linha digitável do boleto copiada!');
  });
};

window.formatCardNumberInput = function(el) {
  let val = el.value.replace(/\\D/g, '').slice(0, 16);
  let formatted = val.match(/.{1,4}/g)?.join(' ') || val;
  el.value = formatted;

  const previewEl = document.getElementById('creditCardNumberPreview');
  const badgeEl = document.getElementById('creditCardFlagBadge');
  if (previewEl) previewEl.textContent = formatted || '•••• •••• •••• ••••';

  if (badgeEl) {
    if (val.startsWith('4')) badgeEl.textContent = 'VISA';
    else if (/^(5[1-5]|2[2-7])/.test(val)) badgeEl.textContent = 'MASTERCARD';
    else if (/^(4011|4389|5041|6362)/.test(val)) badgeEl.textContent = 'ELO';
    else if (/^(34|37)/.test(val)) badgeEl.textContent = 'AMEX';
    else if (/^(6062)/.test(val)) badgeEl.textContent = 'HIPERCARD';
    else badgeEl.textContent = 'CARTÃO';
  }
};

window.formatCardExpiryInput = function(el) {
  let val = el.value.replace(/\\D/g, '').slice(0, 4);
  if (val.length >= 3) {
    val = val.slice(0, 2) + '/' + val.slice(2, 4);
  }
  el.value = val;
  const previewEl = document.getElementById('creditCardExpiryPreview');
  if (previewEl) previewEl.textContent = val || 'MM/AA';
};

window.processSubscriptionPayment = async function(method) {
  if (!currentUser || !currentUser.email) {
    if (typeof showToast === 'function') showToast('Erro: Usuário não identificado.');
    return;
  }

  const plan = window.__selectedSubPlan || 'mensal';
  const payMethod = method || window.__selectedPaymentMethod || 'pix';

  // Validação simples para cartões
  if (payMethod === 'credit_card') {
    const num = (document.getElementById('subCardNumber')?.value || '').replace(/\\D/g, '');
    const exp = document.getElementById('subCardExpiry')?.value || '';
    const cvv = document.getElementById('subCardCvv')?.value || '';
    if (num.length < 13 || exp.length < 5 || cvv.length < 3) {
      if (typeof showToast === 'function') showToast('Por favor, preencha os dados do cartão de crédito corretamente.');
      return;
    }
  }

  if (typeof showToast === 'function') {
    showToast('Processando pagamento seguro com criptografia de ponta a ponta...');
  }

  try {
    const res = await fetch('/api/subscription/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: currentUser.email,
        plan: plan,
        method: payMethod,
        amount: plan === 'anual' ? 100.00 : 10.00
      })
    });

    const data = await res.json();
    if (data && data.success) {
      currentUser.subscription_status = 'active';
      currentUser.subscription_plan = data.plan;
      currentUser.subscription_expires_at = data.expires_at;
      currentUser.subscription_method = data.method;
      try { saveToStorage('nexus_cached_user', currentUser); } catch(e){}

      // Exibe tela de confirmação
      const checkoutView = document.getElementById('subCheckoutView');
      const successView = document.getElementById('subSuccessView');
      if (checkoutView) checkoutView.style.display = 'none';
      if (successView) successView.style.display = 'block';

      const planNameEl = document.getElementById('subSuccessPlanName');
      const txIdEl = document.getElementById('subSuccessTxId');
      const methodEl = document.getElementById('subSuccessMethod');
      const expiresEl = document.getElementById('subSuccessExpires');

      if (planNameEl) planNameEl.textContent = plan === 'anual' ? 'Anual (R$ 100,00)' : 'Mensal (R$ 10,00)';
      if (txIdEl) txIdEl.textContent = data.transaction_id || ('NEXUS-SUB-' + Date.now());
      if (methodEl) {
        const methodLabels = { pix: 'Pix Instantâneo', credit_card: 'Cartão de Crédito', debit_card: 'Cartão de Débito', boleto: 'Boleto Bancário' };
        methodEl.textContent = methodLabels[payMethod] || payMethod.toUpperCase();
      }
      if (expiresEl) {
        expiresEl.textContent = data.expires_at ? new Date(data.expires_at).toLocaleDateString('pt-BR') : '1 ano';
      }

      window.hideTrialDockWidget();
      if (window.__trialTimerInterval) {
        clearInterval(window.__trialTimerInterval);
        window.__trialTimerInterval = null;
      }

      if (typeof showToast === 'function') {
        showToast('🎉 Pagamento aprovado! Sua assinatura está ativa.');
      }

      if (typeof render === 'function') render();
    } else {
      if (typeof showToast === 'function') {
        showToast('Falha no pagamento: ' + (data?.error || 'Tente novamente.'));
      }
    }
  } catch(err) {
    console.error('[ERRO PAGAMENTO]', err);
    if (typeof showToast === 'function') {
      showToast('Erro ao processar pagamento. Verifique a conexão.');
    }
  }
};

window.resetTrialForTesting = async function(email) {
  const targetEmail = email || (currentUser && currentUser.email);
  if (!targetEmail) return;
  try {
    const res = await fetch('/api/subscription/reset-trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: targetEmail })
    });
    const d = await res.json();
    if (d && d.success) {
      if (typeof showToast === 'function') showToast('⏱️ Período de 5 minutos grátis reiniciado para ' + targetEmail);
      window.initTrialAndSubscription();
      if (typeof render === 'function') render();
    }
  } catch(e) {}
};

${clientEngineAnchor}`;

doReplace(clientEngineAnchor, clientEngineToAdd, '5. Motor de Período Gratuito e Checkout injetado no JavaScript cliente');

// 6. INVOCAR initTrialAndSubscription() AO RESTAURAR SESSÃO
const restoreAnchor = norm("sessionStorage.setItem('nexus_session_active', 'true');\n  if (!sessionStorage.getItem('nexus_last_activity')) {");
const restoreCall = norm(`if (typeof window.initTrialAndSubscription === 'function') {
    window.initTrialAndSubscription();
  }
  sessionStorage.setItem('nexus_session_active', 'true');
  if (!sessionStorage.getItem('nexus_last_activity')) {`);

doReplace(restoreAnchor, restoreCall, '6. initTrialAndSubscription() acoplado ao restoreSession');

// 7. ROTAS DE API BACKEND
const apiRoutesAnchor = '// ==================== ROTAS DE ORDENS DE SERVIÇO (O.S.) ====================';
const apiRoutesToAdd = `// ==================== ROTAS DE ASSINATURA & TESTE GRÁTIS (5 MINUTOS) ====================

  function getUserSubscriptionInfo(user) {
    if (!user) return null;
    const now = Date.now();
    const TRIAL_DURATION_SECS = 300; // 5 minutos de teste gratuito

    const isSubscribed = user.subscription_status === 'active' && 
      user.subscription_expires_at && 
      (new Date(user.subscription_expires_at).getTime() > now);

    let trialStartedAt = user.trial_started_at;
    let remainingSecs = 0;
    let isTrialActive = false;

    if (isSubscribed) {
      remainingSecs = 0;
      isTrialActive = false;
    } else {
      if (!trialStartedAt) {
        trialStartedAt = getBrasiliaIsoString(new Date());
        user.trial_started_at = trialStartedAt;
      }
      const elapsedSecs = Math.max(0, Math.floor((now - new Date(trialStartedAt).getTime()) / 1000));
      remainingSecs = Math.max(0, TRIAL_DURATION_SECS - elapsedSecs);
      isTrialActive = remainingSecs > 0;
    }

    const status = isSubscribed ? 'active' : (isTrialActive ? 'trial' : 'expired');

    return {
      success: true,
      email: user.email,
      status: status,
      is_subscribed: isSubscribed,
      is_trial_active: isTrialActive,
      remaining_seconds: remainingSecs,
      trial_duration_seconds: TRIAL_DURATION_SECS,
      trial_started_at: trialStartedAt,
      subscription_plan: user.subscription_plan || null,
      subscription_expires_at: user.subscription_expires_at || null,
      subscription_method: user.subscription_method || null,
      subscription_payment_id: user.subscription_payment_id || null,
      is_admin: user.role === 'Administrador'
    };
  }

  // Rota GET para Consultar Status da Assinatura e Tempo Restante do Teste Grátis
  if (req.method === 'GET' && parsedUrl.pathname === '/api/subscription/status') {
    const email = (parsedUrl.query.email || '').toLowerCase().trim();
    if (!email) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'E-mail obrigatório' }));
    }

    const localUsers = getLocalUsers();
    let user = localUsers.find(u => u && u.email && u.email.toLowerCase() === email);

    if (pool) {
      pool.query(
        'SELECT id, name, email, role, active, created_at, trial_started_at, subscription_plan, subscription_status, subscription_expires_at, subscription_method, subscription_payment_id FROM usuarios WHERE LOWER(email) = LOWER($1)',
        [email]
      ).then(result => {
        if (result.rows && result.rows.length > 0) {
          user = { ...user, ...result.rows[0] };
        }

        if (!user) {
          res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Usuário não encontrado' }));
        }

        // Se ainda não tem trial_started_at, grava agora
        if (!user.trial_started_at) {
          const nowStr = getBrasiliaIsoString(new Date());
          const nowSql = getBrasiliaSqlString(new Date());
          user.trial_started_at = nowStr;
          user.subscription_status = 'trial';
          pool.query("UPDATE usuarios SET trial_started_at = $1, subscription_status = 'trial' WHERE LOWER(email) = LOWER($2)", [nowSql, email]).catch(()=>{});
          saveLocalUsers(localUsers);
        }

        const info = getUserSubscriptionInfo(user);
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(info));
      }).catch(err => {
        if (!user) {
          res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Usuário não encontrado' }));
        }
        if (!user.trial_started_at) {
          user.trial_started_at = getBrasiliaIsoString(new Date());
          user.subscription_status = 'trial';
          saveLocalUsers(localUsers);
        }
        const info = getUserSubscriptionInfo(user);
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(info));
      });
    } else {
      if (!user) {
        res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Usuário não encontrado' }));
      }
      if (!user.trial_started_at) {
        user.trial_started_at = getBrasiliaIsoString(new Date());
        user.subscription_status = 'trial';
        saveLocalUsers(localUsers);
      }
      const info = getUserSubscriptionInfo(user);
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(info));
    }
    return;
  }

  // Rota POST para Processar Pagamento de Assinatura (Mensal R$ 10,00 ou Anual R$ 100,00)
  if (req.method === 'POST' && parsedUrl.pathname === '/api/subscription/pay') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const email = (parsed.email || '').toLowerCase().trim();
        const plan = (parsed.plan || 'mensal').toLowerCase().trim();
        const method = (parsed.method || 'pix').toLowerCase().trim();

        if (!email) {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'E-mail obrigatório' }));
        }

        const validPlans = ['mensal', 'anual'];
        if (!validPlans.includes(plan)) {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Plano inválido. Escolha mensal (R$ 10,00) ou anual (R$ 100,00).' }));
        }

        // Duração: Mensal (+30 dias) ou Anual (+365 dias)
        const now = new Date();
        const expiresDate = new Date(now.getTime() + (plan === 'anual' ? 365 : 30) * 24 * 60 * 60 * 1000);
        const expiresIso = getBrasiliaIsoString(expiresDate);
        const expiresSql = getBrasiliaSqlString(expiresDate);
        const txId = 'NEXUS-SUB-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
        const amount = plan === 'anual' ? 100.00 : 10.00;

        // Atualiza no cache local
        const localUsers = getLocalUsers();
        let targetUser = localUsers.find(u => u && u.email && u.email.toLowerCase() === email);
        if (targetUser) {
          targetUser.subscription_status = 'active';
          targetUser.subscription_plan = plan;
          targetUser.subscription_expires_at = expiresIso;
          targetUser.subscription_method = method;
          targetUser.subscription_payment_id = txId;
          saveLocalUsers(localUsers);
        }

        // Atualiza no SQL Server
        if (pool) {
          try {
            await pool.query(
              \`UPDATE usuarios 
               SET subscription_status = 'active',
                   subscription_plan = $1,
                   subscription_expires_at = $2,
                   subscription_method = $3,
                   subscription_payment_id = $4
               WHERE LOWER(email) = LOWER($5)\`,
              [plan, expiresSql, method, txId, email]
            );
            console.log(\`✅ [SQL SERVER ASSINATURA] Plano \${plan.toUpperCase()} ativado com sucesso para \${email} até \${expiresSql} (Tx: \${txId})\`);
          } catch(sqlErr) {
            console.warn('[AVISO BD] Falha ao atualizar assinatura no SQL Server:', sqlErr.message);
          }
        }

        const methodNames = { pix: 'Pix', credit_card: 'Cartão de Crédito', debit_card: 'Cartão de Débito', boleto: 'Boleto Bancário' };
        recordSystemLog(
          targetUser ? targetUser.name : 'Usuário',
          email,
          'Assinatura',
          'Financeiro',
          \`Ativou plano \${plan.toUpperCase()} (R$ \${amount.toFixed(2)}) via \${methodNames[method] || method} - Tx: \${txId}\`
        );

        broadcastEvent('subscription_activated', {
          email: email,
          plan: plan,
          amount: amount,
          transaction_id: txId,
          expires_at: expiresIso
        });

        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          message: 'Assinatura realizada com sucesso!',
          transaction_id: txId,
          plan: plan,
          amount: amount,
          method: method,
          expires_at: expiresIso
        }));
      } catch(e) {
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Erro ao processar assinatura: ' + e.message }));
      }
    });
    return;
  }

  // Rota POST para Resetar o Período Gratuito de 5 Minutos (Para Testes / Homologação)
  if (req.method === 'POST' && parsedUrl.pathname === '/api/subscription/reset-trial') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const email = (parsed.email || '').toLowerCase().trim();
        if (!email) {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'E-mail obrigatório' }));
        }

        const nowIso = getBrasiliaIsoString(new Date());
        const nowSql = getBrasiliaSqlString(new Date());

        const localUsers = getLocalUsers();
        const u = localUsers.find(x => x && x.email && x.email.toLowerCase() === email);
        if (u) {
          u.trial_started_at = nowIso;
          u.subscription_status = 'trial';
          saveLocalUsers(localUsers);
        }

        if (pool) {
          await pool.query(
            "UPDATE usuarios SET trial_started_at = $1, subscription_status = 'trial' WHERE LOWER(email) = LOWER($2)",
            [nowSql, email]
          ).catch(()=>{});
        }

        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Período gratuito de 5 minutos resetado com sucesso!' }));
      } catch(e) {
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  ${apiRoutesAnchor}`;

doReplace(apiRoutesAnchor, apiRoutesToAdd, '7. Rotas de API backend de assinatura inseridas');

// 8. ATUALIZAR SELECT DO LOGIN
const loginSelectOld = 'SELECT id, name, email, password, role, active, last_login, cpf, phone, birth_date, terms_accepted, created_at, device_type, must_change_password FROM usuarios WHERE LOWER(email) = LOWER($1)';
const loginSelectNew = 'SELECT id, name, email, password, role, active, last_login, cpf, phone, birth_date, terms_accepted, created_at, device_type, must_change_password, trial_started_at, subscription_plan, subscription_status, subscription_expires_at, subscription_method, subscription_payment_id FROM usuarios WHERE LOWER(email) = LOWER($1)';
doReplace(loginSelectOld, loginSelectNew, '8. SELECT do login atualizado com campos de assinatura');

// 9. ATUALIZAR SELECT DO GET /api/users
const usersSelectOld = "SELECT id, name, email, role, active, created_at, last_login, cpf, phone, birth_date, terms_accepted, device_type, must_change_password FROM usuarios ORDER BY id ASC";
const usersSelectNew = "SELECT id, name, email, role, active, created_at, last_login, cpf, phone, birth_date, terms_accepted, device_type, must_change_password, trial_started_at, subscription_plan, subscription_status, subscription_expires_at, subscription_method, subscription_payment_id FROM usuarios ORDER BY id ASC";
doReplace(usersSelectOld, usersSelectNew, '9. SELECT de usuários atualizado com campos de assinatura');

// 10. ATUALIZAR pageConfig COM CARD DE ASSINATURA
const pageConfigAnchor = '<div class="cfg-proportional-container" style="display:grid; grid-template-columns:minmax(0, 1.35fr) minmax(0, 1fr); gap:20px; align-items:start;">';
const pageConfigSubCard = `<!-- PAINEL DE ASSINATURA E PLANO -->
  <div class="panel" style="margin-bottom:20px; padding:22px; background:linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(5,150,105,0.03) 100%); border:1.5px solid rgba(16,185,129,0.3); border-radius:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
    <div style="display:flex; align-items:center; gap:16px;">
      <div style="width:52px; height:52px; border-radius:16px; background:linear-gradient(135deg, rgba(16,185,129,0.25), rgba(5,150,105,0.15)); border:1.5px solid rgba(16,185,129,0.5); display:flex; align-items:center; justify-content:center; font-size:26px;">
        💳
      </div>
      <div>
        <div style="display:flex; align-items:center; gap:8px;">
          <h3 style="font-size:17px; font-weight:900; margin:0; color:var(--text);">Plano & Assinatura</h3>
          \\${(currentUser && currentUser.subscription_status === 'active')
            ? '<span class="role-badge" style="background:#10B981; color:#fff; font-weight:800;">✓ Assinatura Ativa (' + (currentUser.subscription_plan === 'anual' ? 'Anual R$ 100' : 'Mensal R$ 10') + ')</span>'
            : '<span class="role-badge" style="background:#F59E0B; color:#fff; font-weight:800;">⏱️ Período Gratuito (5 Minutos)</span>'}
        </div>
        <p style="font-size:13px; color:var(--text-dim); margin:4px 0 0 0;">
          \\${(currentUser && currentUser.subscription_status === 'active')
            ? 'Válido até ' + (currentUser.subscription_expires_at ? new Date(currentUser.subscription_expires_at).toLocaleDateString('pt-BR') : 'Ativo')
            : 'Após os 5 minutos de teste gratuito, escolha o Plano Mensal (R$ 10,00) ou Anual (R$ 100,00).'}
        </p>
      </div>
    </div>
    <div style="display:flex; gap:10px; align-items:center;">
      <button type="button" onclick="window.openSubscriptionPaywall(false)" style="padding:10px 20px; border-radius:12px; background:linear-gradient(135deg, #10B981, #059669); color:#fff; font-weight:800; font-size:13px; border:none; cursor:pointer; box-shadow:0 6px 18px rgba(16,185,129,0.35);">
        Gerenciar / Trocar Plano
      </button>
      \\${(currentUser && currentUser.role === 'Administrador') ? \`
        <button type="button" onclick="window.resetTrialForTesting()" style="padding:10px 14px; border-radius:12px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:var(--text); font-weight:700; font-size:12px; cursor:pointer;">
          ⏱️ Resetar 5m (Teste)
        </button>
      \` : ''}
    </div>
  </div>

  ${pageConfigAnchor}`;

doReplace(pageConfigAnchor, pageConfigSubCard, '10. Card de Assinatura integrado no pageConfig');

// 11. ATUALIZAR pageUsuarios COM BADGES DE ASSINATURA NA LISTA DE USUÁRIOS
const pageUsuariosBadgeAnchor = String.raw`<span class="role-badge \${isAdminUser ? 'admin' : 'user'}">\${u.role}</span>`;
const pageUsuariosBadgeToAdd = String.raw`<span class="role-badge \${isAdminUser ? 'admin' : 'user'}">\${u.role}</span>
                \${(u.subscription_status === 'active')
                  ? \`<span class="role-badge" style="background:rgba(16,185,129,0.18); border:1px solid #10B981; color:#34D399; font-weight:800;">⭐ Plano \${u.subscription_plan === 'anual' ? 'Anual' : 'Mensal'}</span>\`
                  : \`<span class="role-badge" style="background:rgba(245,158,11,0.18); border:1px solid #F59E0B; color:#FBBF24; font-weight:800;">⏱️ Teste 5m</span>\`}`;

doReplace(pageUsuariosBadgeAnchor, pageUsuariosBadgeToAdd, '11. Badges de assinatura integradas no pageUsuarios');

fs.writeFileSync(serverPath, code, 'utf8');
console.log('✅ SUCESSO: Todas as 11 etapas aplicadas com perfeição em server.js!');
