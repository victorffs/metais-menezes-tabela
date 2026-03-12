/**
 * Cloudflare Worker — Bling Webhook Bridge
 *
 * Recebe notificações do Bling e dispara o GitHub Actions workflow
 * que atualiza o estoque em estoque.metaismenezes.com.br.
 *
 * Variáveis de ambiente (configurar em Workers > Settings > Variables):
 *   GH_PAT          — GitHub Personal Access Token (repo scope)
 *   GH_REPO         — ex: "victorffs/metais-menezes-tabela"
 *   WEBHOOK_SECRET  — string qualquer para validar que veio do Bling (opcional mas recomendado)
 */

export default {
  async fetch(request, env) {
    // Só aceita POST
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Validação opcional de secret (configure no Bling e aqui como WEBHOOK_SECRET)
    const secret = request.headers.get('X-Bling-Secret') || request.headers.get('Authorization');
    if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Dispara o GitHub Actions via repository_dispatch
    const response = await fetch(
      `https://api.github.com/repos/${env.GH_REPO}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GH_PAT}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'bling-webhook-bridge',
        },
        body: JSON.stringify({ event_type: 'bling-stock-update' }),
      }
    );

    if (response.status === 204) {
      console.log('GitHub Actions triggered successfully');
      return new Response('OK', { status: 200 });
    } else {
      const text = await response.text();
      console.error('GitHub API error:', response.status, text);
      return new Response('Error triggering workflow', { status: 500 });
    }
  },
};
