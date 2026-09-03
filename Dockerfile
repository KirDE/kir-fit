FROM node:22-bookworm-slim AS build
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm exec -w @kir-fit/api -- prisma generate --schema prisma/schema.prisma && npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY apps/api/prisma apps/api/prisma
RUN npm exec -w @kir-fit/api -- prisma generate --schema prisma/schema.prisma
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /app/uploads /app/private/nutrition && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["sh","-c","npm exec -w @kir-fit/api -- prisma migrate deploy --schema prisma/schema.prisma && node apps/api/dist/server.js"]
