# Multi-stage: the bundler stage carries the whole dependency tree, the
# runtime stage ships only the single-file bundle Bun produced — no
# node_modules in the final image. Both tags are pinned to the Bun version
# in package.json (packageManager); bump them together, deliberately.

# --- bundler -----------------------------------------------------------------
FROM oven/bun:1.4.3 AS bundler
WORKDIR /app

# Dependencies first, alone, so this layer caches across source edits. The
# lockfile is frozen; production deps only — the bundle needs no dev tools.
# --ignore-scripts skips the `prepare` script (husky activation, a dev tool
# that isn't even installed here); every runtime dependency is pure JS with
# no lifecycle scripts of its own.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY src src
# Bun runs TypeScript natively, but bundling still pays off in the image: one
# self-contained file instead of a src/ tree plus node_modules.
RUN bun build --target=bun --outfile=dist/index.js src/index.ts

# --- runtime ------------------------------------------------------------------
FROM oven/bun:1.4.3-slim
WORKDIR /app
# The oven/bun images ship a non-root `bun` user; the server writes nothing
# to disk, but non-root is still the right default.
USER bun

COPY --from=bundler --chown=bun:bun /app/dist/index.js dist/index.js

ENV NODE_ENV=production
EXPOSE 3000

# Exec form cannot expand ${PORT}, so the one-liner reads the env itself
# (top-level await works in `bun --eval`). /health is the unauthenticated
# liveness route.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["bun", "--eval", "const port = Number(process.env.PORT ?? 3000); const response = await fetch(`http://127.0.0.1:${port}/health`); if (!response.ok) process.exit(1);"]

CMD ["bun", "dist/index.js"]
