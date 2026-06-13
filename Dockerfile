FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts/ scripts/
COPY src/ src/
RUN npx tsc

# Bundle into a single self-contained CJS file with the build-time version
# stamp injected via esbuild --define. The .dockerignore excludes .git, so
# pass the version explicitly via BUILD_VERSION (release CI sets it from the
# tag + commit SHA; local `docker build` without --build-arg falls back to
# `<pkg.version>+unknown` which is honest about provenance).
ARG BUILD_VERSION=
ENV BUILD_VERSION=${BUILD_VERSION}
RUN node scripts/build-bundle.mjs

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist/ dist/
ENV NODE_ENV=production
# Default entrypoint runs the bundled CJS so `docker run ... --version`
# reports the baked stamp. dist/cli.js is also present for consumers that
# pull the image as a build stage (e.g. a gateway that bakes backends in at
# build time) and prefer the modular entry — but `node dist/bundle.cjs` is
# the canonical path post-B8c.
ENTRYPOINT ["node", "dist/bundle.cjs"]
