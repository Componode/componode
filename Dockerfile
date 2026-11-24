# Single-stage build-and-runtime image for Componode.
# The image builds the monorepo from source, then runs the backend which also
# serves the built frontend static assets.

FROM node:24.22.2-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8

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
