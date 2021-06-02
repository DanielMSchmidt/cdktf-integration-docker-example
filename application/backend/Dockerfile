FROM node:alpine

ADD package* .
RUN npm install
ADD . .
RUN npm run build

CMD ["node", "src/index.js"]
