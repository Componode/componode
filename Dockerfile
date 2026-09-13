# Single-stage build-and-runtime image for Componode.
# The image builds the monorepo from source, then runs the backend which also
# serves the built frontend static assets.

FROM node:24.21.0-alpine

RUN apk add --no-cache wget && \
    addgroup -g 10001 componode && \
    adduser -u 10001 -G componode -D componode

RUN corepack enable pnpm

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

USER componode

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "packages/backend/dist/server.js"]
