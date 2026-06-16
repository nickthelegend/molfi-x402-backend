# Build Stage
FROM node:22-slim AS builder

# Install system dependencies needed for compiling native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@10.33.0

WORKDIR /app

# Copy lockfiles and workspace configs
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies (including devDependencies to build TypeScript)
RUN pnpm install --frozen-lockfile

# Copy configuration and sources
COPY tsconfig.json vercel.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Build the project
RUN pnpm build

# Production Runtime Stage
FROM node:22-slim AS runner

# Install pnpm
RUN npm install -g pnpm@10.33.0

WORKDIR /app

# Copy package and lockfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

# Copy build artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Expose port (corresponds to PORT in env)
EXPOSE 8787

# Set start command
CMD ["node", "dist/src/index.js"]
