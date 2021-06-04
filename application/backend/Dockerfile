FROM node:alpine

ADD package* ./
RUN npm install --production=false
ADD ./ ./
# RUN npm run build

CMD ["ts-node", "src/index.ts"]
