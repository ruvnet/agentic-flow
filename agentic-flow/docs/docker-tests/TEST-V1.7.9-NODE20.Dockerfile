# Test agentic-flow v1.7.9 with Node 20 (recommended environment)
FROM node:20-alpine

RUN apk add --no-cache python3 make g++ sqlite sqlite-dev

WORKDIR /test

RUN echo "========================================" && \
    echo "Testing npx agentic-flow@1.7.9 with Node 20" && \
    echo "========================================" && \
    npx agentic-flow@1.7.9 --version 2>&1

CMD ["echo", "✅ Test complete"]
