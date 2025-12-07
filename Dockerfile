# Syntax: docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# Install deps first to leverage Docker layer caching
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

RUN npm run build
ENV NODE_ENV=production
RUN npm prune --production

EXPOSE 3001
CMD ["node", "dist/server.js"]
