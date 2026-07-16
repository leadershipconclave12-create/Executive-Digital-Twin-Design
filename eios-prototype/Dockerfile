# EIOS — single container: API + built web UI.
# Build:  docker build -t eios .
# Run:    docker run -p 4180:4180 --env-file .env -v eios-data:/app/data eios
FROM node:22-alpine AS build
WORKDIR /app
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm --prefix server ci && npm --prefix web ci
COPY server/ server/
COPY web/ web/
RUN npm --prefix server run build && npm --prefix web run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json server/
RUN npm --prefix server ci --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
# The event log lives here — mount a volume or the org forgets on restart.
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 4180
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:4180/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
