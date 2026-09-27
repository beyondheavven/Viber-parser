FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm install

COPY src/ ./src/
RUN npm run build

EXPOSE 9000

ENV PORT=9000
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
