# 📦 Rastreio

Sistema simples de rastreio para integrar com gateways de venda (drop) via **webhook**,
com **login por cliente**, **página pública de rastreio** e **envio de mensagens por
WhatsApp e e-mail**.

Feito para ser fácil de mexer: um servidor Node.js só, banco em arquivo (SQLite),
telas em HTML (EJS). Sem framework de frontend, sem build.

---

## Como rodar

```bash
npm install
npm start
```

Acesse **http://localhost:3000** → **Criar conta** → pronto.

Para desenvolvimento (reinicia sozinho ao salvar): `npm run dev`.

---

## Como funciona (fluxo)

1. Cada cliente cria uma conta (login/senha, dados isolados no banco).
2. Na aba **Webhook**, o cliente copia a URL única dele e cola no gateway.
3. Quando o gateway recebe uma venda, ele faz um `POST` nessa URL com os dados do comprador.
4. O sistema:
   - gera um **código de rastreio** (por enquanto **aleatório**, só para testes);
   - salva o pedido;
   - dispara a **mensagem** (WhatsApp + e-mail) usando o template do cliente.
5. O comprador acompanha em **`/rastreio/CODIGO`** (página pública).

### Testar sem gateway
Na aba **Webhook** → botão **“Disparar pedido de teste”**. Ou via terminal:

```bash
curl -X POST "http://localhost:3000/webhook/SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nome":"João","email":"joao@email.com","telefone":"11999998888","order_id":"123"}'
```

O webhook aceita vários formatos de payload — ele procura por `nome`, `email`,
`telefone`/`whatsapp`, etc. (inclusive campos aninhados como `customer.email`).
O JSON cru fica salvo em cada rastreio para você ajustar o mapeamento depois de
ver o que cada gateway manda de verdade (arquivo [`src/routes/webhook.js`](src/routes/webhook.js)).

---

## Envio de mensagens

Na aba **Configurações** você escolhe o **modo**:

- **Simulado** (padrão): não envia nada; a mensagem aparece no console e na aba **Logs**.
  Perfeito para ver o sistema funcionando sem credencial nenhuma.
- **Real**: envia de verdade usando:
  - **WhatsApp**: Z-API, Evolution API ou um endpoint HTTP genérico
    (código em [`src/services/whatsapp.js`](src/services/whatsapp.js)).
  - **E-mail**: qualquer servidor **SMTP** (Gmail, Zoho, etc.)
    (código em [`src/services/mailer.js`](src/services/mailer.js)).

As mensagens usam variáveis: `{nome}`, `{codigo}`, `{status}`, `{link}`, `{loja}`.

---

## Próximo passo: código de rastreio real

Hoje o código é aleatório. Para integrar com a transportadora/Correios de verdade,
troque a função `gerarCodigo()` em [`src/services/tracking.js`](src/services/tracking.js)
por uma chamada à API da transportadora que retorne o código oficial. O resto do
sistema continua igual.

---

## Estrutura

```
server.js               → sobe o servidor
src/db.js               → banco (SQLite) e tabelas
src/middleware.js       → login obrigatório + URL base
src/routes/
  auth.js               → cadastro / login / logout
  app.js                → painel (dashboard, webhook, mensagens, config, rastreios, logs)
  webhook.js            → endpoint público que o gateway chama
  public.js             → página pública de rastreio
src/services/
  tracking.js           → gera o código (aleatório por enquanto)
  templates.js          → troca as variáveis {nome} {codigo} ...
  whatsapp.js           → envio WhatsApp (Z-API / Evolution / genérico)
  mailer.js             → envio de e-mail (SMTP)
  notify.js             → junta tudo e registra os logs
views/                  → telas (EJS)
public/style.css        → visual
data/rastreio.db        → banco (criado automaticamente)
```
