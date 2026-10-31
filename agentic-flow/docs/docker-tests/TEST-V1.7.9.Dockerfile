# Test agentic-flow v1.7.9 with better-sqlite3 v11.x for Node 18 compatibility
FROM node:18-alpine

RUN apk add --no-cache python3 make g++ sqlite sqlite-dev

WORKDIR /test

RUN echo "========================================" && \
    echo "Testing npx agentic-flow@1.7.9" && \
    echo "Expecting v1.7.9 with better-sqlite3 v11.x" && \
    echo "========================================" && \
    npx agentic-flow@1.7.9 --version 2>&1 | head -20

CMD ["echo", "✅ Test complete"]
