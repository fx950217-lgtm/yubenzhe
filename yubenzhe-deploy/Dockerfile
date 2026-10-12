FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /opt/yubenzhe
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node upstream ./upstream
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node reports ./reports
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node public ./public
RUN test -s public/frontend/index.html && test -s public/admin/index.html \
    && test ! -e public/frontend/internal && test ! -L public/frontend/internal
USER node
CMD ["node","server/start.mjs"]
