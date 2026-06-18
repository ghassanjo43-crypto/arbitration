# Multi-stage build for the NestJS API.
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

# ---- development ----
FROM base AS development
RUN npm install
COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN npx prisma generate
CMD ["npm", "run", "dev"]

# ---- build ----
FROM base AS build
RUN npm install
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @gaap/shared
WORKDIR /app/apps/api
RUN npx prisma generate && npm run build

# ---- production ----
FROM node:22-alpine AS production
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
