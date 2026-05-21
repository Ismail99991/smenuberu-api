FROM node:20-alpine AS builder 
RUN apk add --no-cache openssl 
WORKDIR /app 
COPY package*.json ./ 
COPY prisma ./prisma/ 
RUN npm ci 
RUN npx prisma generate 
COPY . . 
RUN npm run build 
FROM node:20-alpine 
RUN apk add --no-cache openssl 
WORKDIR /app 
COPY --from=builder /app/node_modules ./node_modules 
COPY --from=builder /app/dist ./dist 
COPY --from=builder /app/prisma ./prisma 
COPY --from=builder /app/package*.json ./ 
EXPOSE 3000 
CMD ["node", "dist/server.js"] 
