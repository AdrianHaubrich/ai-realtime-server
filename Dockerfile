# Syntax: docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# Install deps first to leverage Docker layer caching
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

EXPOSE 3001
CMD ["npm", "start"]
