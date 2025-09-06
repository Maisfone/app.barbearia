FROM node:20-alpine

WORKDIR /app

# Install dependencies (prod)
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source
COPY . .

ENV NODE_ENV=production
EXPOSE 4000

# Run DB migrations then start API
CMD ["sh", "-c", "npm run db:init && npm start"]

