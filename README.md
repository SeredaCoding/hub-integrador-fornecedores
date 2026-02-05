🚀 Hub Integrador de Fornecedores (Middleware)
Este projeto é um serviço intermediário inteligente (Middleware) que recebe dados de fornecedores e atualiza o ERP apenas quando há mudanças reais de preço ou estoque. Isso economiza até 90% do processamento desnecessário no ERP através de uma técnica chamada Diffing.

⚙️ Diferenciais do Projeto
Diffing com Redis: O sistema salva o último estado de cada produto. Se o fornecedor enviar o mesmo dado 1000 vezes, o ERP só será avisado uma vez.

Isolamento (Namespacing): Suporte a múltiplos fornecedores para o mesmo SKU sem conflito de dados.

Segurança: Proteção de endpoint via x-api-key.

Resiliência: Cache com tempo de expiração (TTL) de 24 horas.

🛠️ Tecnologias
Node.js: Runtime principal.

Redis: Banco de dados em memória para cache de alta performance.

Express: Framework para a API.

Docker: Gerenciamento do container do Redis.

Axios: Cliente HTTP para envio de Webhooks.

🚀 Como Rodar Localmente
1. Clonar o repositório
Bash
git clone https://github.com/seu-usuario/hub-integrador.git
cd hub-integrador
2. Configurar a Infraestrutura (Redis)
Certifique-se de ter o Docker instalado e rode:

Bash
docker-compose up -d
3. Configurar Variáveis de Ambiente
Crie um arquivo .env na raiz do projeto:

Snippet de código
ERP_WEBHOOK_URL=https://seu-erp.com/api/webhook
HUB_API_KEY=HUB_API_KEY
4. Instalar e Iniciar
Bash
npm install
node src/server.js
🧪 Testando a Integração
Exemplo via PowerShell (Windows)
Para testar o envio de dados e validar o cache do Redis, use o comando abaixo:

PowerShell
# Definir a chave de segurança
$headers = @{"x-api-key"='HUB_API_KEY'}

# Enviar atualização de estoque
Invoke-RestMethod -Uri http://localhost:3000/v1/update-stock `
    -Method Post `
    -ContentType "application/json" `
    -Headers $headers `
    -Body '{"sku": "PRODUTO-BEE", "preco": 50.00, "estoque": 100, "fornecedor": "forn_a"}'
Nota: Na primeira execução, você receberá status: success. Se rodar o mesmo comando novamente, o Hub retornará status: skipped, indicando que o cache evitou uma requisição desnecessária ao ERP.

🔍 Visualizando os Dados no Redis
Para ver as chaves salvas no cache durante o teste:

Bash
docker exec -it hub-redis redis-cli
KEYS *
Você verá chaves no formato f:fornecedor:sku:id.