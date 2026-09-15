# Pinned runtime for the local integration handoff. Model artifacts are not
# copied into this image; the optional AI service owns its external bundle.
FROM node:22.14.0-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
# Includes the OFL-licensed static TTF used by the PDF renderer; no host font
# mount is required in the production image.
COPY assets ./assets
COPY migrations ./migrations
COPY scripts ./scripts
RUN npm run build

FROM node:22.14.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts

USER node
EXPOSE 3005
CMD ["node", "dist/server.js"]
