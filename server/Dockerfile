FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=optional
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY db ./db
EXPOSE 3001
CMD ["npm", "run", "dev"]
