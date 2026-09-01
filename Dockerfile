# ==========================================================================
# Dockerfile - Nexus Financeiro Hub (Produção & Alta Performance)
# ==========================================================================
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --only=production --ignore-scripts

COPY . .

RUN addgroup --system --gid 1001 nodejs &&     adduser --system --uid 1001 nexususer &&     chown -R nexususer:nodejs /app

USER nexususer

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e 'require("http").get("http://127.0.0.1:" + (process.env.PORT || 3000) + "/api/health", (r) => { if (r.statusCode !== 200) process.exit(1); }).on("error", () => process.exit(1));'

 CMD ["node", "server.js"]
