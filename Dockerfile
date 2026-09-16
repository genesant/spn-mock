FROM public.ecr.aws/docker/library/node:22-slim
ENV NODE_ENV=production COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# pnpm 10.x understands `onlyBuiltDependencies` in pnpm-workspace.yaml (lockfile v9); newer majors reject it.
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /app

# Dependencies first so they are cached between source changes. better-sqlite3 ships prebuilt binaries
# for linux x64/arm64, no compiler needed. tsx (dev dependency) runs the TypeScript sources directly.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY tsconfig.json ./
COPY src ./src

# State lives outside the image: SPN_DB_PATH points into a mounted volume (see README).
ENV SPN_PORT=4100 SPN_DB_PATH=/data/spn.db
VOLUME ["/data"]
EXPOSE 4100

# Seed is idempotent: creates the tenant, destination and the Wave API key from env on first start,
# leaves existing data alone afterwards.
CMD ["sh", "-c", "pnpm run seed && pnpm run start"]
