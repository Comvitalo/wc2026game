# --- Build stage: install deps (compiles better-sqlite3 if no prebuilt binary) ---
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Toolchain for native modules (better-sqlite3). Removed by leaving this stage.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# --- Runtime stage: slim image, no compilers ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/tippspiel.db

COPY --from=build /app /app

# The SQLite file lives on a mounted volume at /data (see fly.toml).
VOLUME ["/data"]
EXPOSE 3000

# Seed is idempotent: it creates the schema and fills only empty tables, so it
# is safe to run on every boot. Then start the server.
CMD ["sh", "-c", "node seed.js && node server.js"]
