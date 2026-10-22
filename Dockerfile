# Build stage — compiles TypeScript
# Node pinned by version and digest (22.23.4, the security release of 20 Oct 2026, which
# fixes a Brotli out-of-bounds write and TLS hostname bypasses). A floating tag moved
# under us unseen, and the host's rules want pinned images. Bump deliberately.
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Runtime stage — lean image with only compiled output
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/ ./dist/
COPY public/ ./public/

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server.js"]
