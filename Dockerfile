FROM node:24-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime

RUN apk add --no-cache subversion
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV SVN_DESK_DATA_DIR=/app/data

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server-dist ./server-dist
COPY --from=build /app/dist/client ./dist/client
RUN mkdir -p /app/data && chown node:node /app/data

EXPOSE 3000
USER node
CMD ["node", "server-dist/index.js"]
