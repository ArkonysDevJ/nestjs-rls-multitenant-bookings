# API image. Build from the repository root, where the lockfile and the
# workspace manifests live:
#   docker build -f apps/api/Dockerfile -t bookings-api .
# Kept under apps/api/ rather than at the root so that adding it does not
# silently switch the builder of an existing deployment that auto-detects
# a root Dockerfile.

# Exact patch tag instead of `24-slim`: the security fixes this image relies
# on start at 24.22.1, and a fixed tag means rebuilding the same commit gives
# the same runtime. Debian slim rather than Alpine keeps glibc, which the
# official Node binaries are built against, while dropping compilers and docs
# the API never uses.
ARG NODE_IMAGE=node:24.22.1-slim

# --- Stage 1: build -----------------------------------------------------------
# Compiling needs the Nest CLI and TypeScript (devDependencies). None of that
# toolchain should be present in the image that serves traffic.
FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Manifests first, so the dependency layer is reused when only source changes.
# apps/web's manifest is copied only because npm validates every workspace in
# the lockfile; the frontend is deployed separately and its code never enters
# this image.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace=apps/api
COPY apps/api/ apps/api/
RUN npm run build --workspace=apps/api

# --- Stage 2: runtime ---------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Production dependencies only, resolved from the same lockfile as the build.
# --omit=optional as well: typescript is marked devOptional in the lockfile
# (an optional peer of a runtime dependency), so --omit=dev alone keeps it.
# --ignore-scripts is safe here because no runtime dependency of this API has
# an install script, and it keeps install-time code out of the image.
RUN npm ci --omit=dev --omit=optional --workspace=apps/api --ignore-scripts \
  && npm cache clean --force
# Only the compiled output. TypeScript sources, SQL migrations, pgTAP tests and
# the Bruno collections are not read by the running API, so they stay out.
COPY --from=build /app/apps/api/dist apps/api/dist

# This process holds the Supabase service-role key, which bypasses RLS. Running
# as the image's unprivileged `node` user, with the code owned by root, limits
# what a compromised process could change inside the container.
USER node
WORKDIR /app/apps/api
# Documentation only: the app listens on $PORT (3000 when unset) on 0.0.0.0.
EXPOSE 3000
# Exec form makes node PID 1, so it receives SIGTERM directly and the Nest
# shutdown hooks run; an `npm start` wrapper would sit in between.
CMD ["node", "dist/main.js"]
