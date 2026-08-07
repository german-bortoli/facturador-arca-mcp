FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

COPY package.json package-lock.json ./
# Generous retries/timeouts: npm ci pulls native prebuilds (better-sqlite3)
# from GitHub besides the registry, which times out on slow server networks.
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm config set fetch-timeout 600000 \
  && npm ci --no-audit --no-fund

COPY . .

RUN mkdir -p /app/invoices

ENV NODE_ENV=production

EXPOSE 9000 8876

CMD ["npm", "run", "mcp:server"]
