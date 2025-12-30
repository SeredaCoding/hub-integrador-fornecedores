# 🚀 Hub Integrador de Fornecedores (Middleware)

Este projeto é um serviço intermediário (Hub) que monitora APIs de fornecedores e envia Webhooks para o ERP apenas quando há alteração de preço ou estoque.

## ⚙️ Arquitetura

1. **Polling:** Consulta a API do fornecedor a cada X minutos.
2. **Diffing:** Compara os dados recebidos com o cache (Redis).
3. **Webhook:** Se houver mudança, envia POST para o ERP.

## 🛠️ Tecnologias

- **Node.js**: Runtime.
- **Redis**: Cache para estado dos produtos (preço/estoque anterior).
- **Axios**: Requisições HTTP.
- **Node-Cron**: Agendamento de tarefas.

## 🚀 Como rodar localmente

1. Clone o repositório.
2. Instale as dependências:
   ```bash
   npm install