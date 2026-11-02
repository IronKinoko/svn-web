# syntax=docker/dockerfile:1

FROM node:24-alpine AS build-base

WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY

RUN corepack enable pnpm \
 && npm config set registry "$NPM_REGISTRY"

FROM build-base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
    pnpm install --frozen-lockfile --prefer-offline --store-dir=/pnpm/store

COPY . .
RUN --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
    pnpm run build \
 && pnpm prune --prod \
 && rm -rf node_modules/.tmp node_modules/.vite-temp

FROM node:24-alpine AS runtime

RUN apk add --no-cache subversion
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SVN_DESK_CLIENT_DIR=/app/client \
    SVN_DESK_DATA_DIR=/app/data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/client ./client
COPY --from=build /app/dist/server ./server

RUN mkdir -p /app/data && chown node:node /app/data

EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
