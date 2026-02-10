FROM node:18

WORKDIR /app

# Copiar apenas os arquivos de dependências primeiro (otimiza cache)
COPY package*.json ./

RUN npm install

# Copiar o restante do código (incluindo o server.js)
COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]