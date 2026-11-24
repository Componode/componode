# Single-stage build-and-runtime image for Componode.
# The image builds the monorepo from source, then runs the backend which also
# serves the built frontend static assets.

FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5

RUN apk add --no-cache wget && \
    addgroup -g 10001 componode && \
    adduser -u 10001 -G componode -D componode

RUN npm install -g pnpm@9.15.2

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

USER componode

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "packages/backend/dist/server.js"]
