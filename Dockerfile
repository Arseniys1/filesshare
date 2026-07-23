FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY docker/app-entrypoint.sh /usr/local/bin/app-entrypoint.sh

RUN mkdir -p /app/data /var/filesshare/uploads \
  && chmod +x /usr/local/bin/app-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/app-entrypoint.sh"]
CMD ["node", "server.js"]
