# One image for both deployment modes (shared / dedicated); the mode is chosen by env at runtime.
# glibc (Debian slim) so the prebuilt @node-rs/argon2 binary works.
ARG NODE_IMAGE=node:24.22.0-slim

# ---- deps: full install (postinstall runs `prisma generate`, so the schema must be present) ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ---- build: next build -> .next/standalone ----
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.json next.config.ts ./
COPY src ./src
COPY openapi ./openapi
RUN npm run build

# ---- migrator (build with --target migrator): Prisma CLI + migrations, runs `migrate deploy` ----
FROM ${NODE_IMAGE} AS migrator
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime (default, last stage): minimal standalone server, non-root ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
