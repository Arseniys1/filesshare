FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY docker/app-entrypoint.sh /usr/local/bin/app-entrypoint.sh

RUN mkdir -p /app/data /var/filesshare/uploads \
  && chmod +x /usr/local/bin/app-entrypoint.sh \
  && chown -R nextjs:nodejs /app /var/filesshare/uploads

USER nextjs

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/app-entrypoint.sh"]
CMD ["node", "server.js"]
