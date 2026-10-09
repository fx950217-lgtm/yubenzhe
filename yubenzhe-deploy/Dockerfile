FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /opt/yubenzhe
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node upstream ./upstream
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node reports ./reports
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node public ./public
RUN test -s public/frontend/index.html && test -s public/admin/index.html
USER node
CMD ["node","server/start.mjs"]
