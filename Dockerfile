FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

RUN mkdir -p /app/invoices

ENV NODE_ENV=production

EXPOSE 9000 8876

CMD ["npm", "run", "mcp:server"]
