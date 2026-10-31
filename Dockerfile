FROM node:24-alpine AS base

WORKDIR /app
RUN corepack enable pnpm

FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM base AS runtime

RUN apk add --no-cache subversion
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV SVN_DESK_DATA_DIR=/app/data

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/server-dist ./server-dist
COPY --from=build /app/dist/client ./dist/client
RUN mkdir -p /app/data && chown node:node /app/data

EXPOSE 3000
USER node
CMD ["node", "server-dist/index.js"]
