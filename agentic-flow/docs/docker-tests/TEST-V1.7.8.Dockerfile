# Test agentic-flow v1.7.8 with fixed agentdb dependency
FROM node:18-alpine

RUN apk add --no-cache python3 make g++ sqlite sqlite-dev

WORKDIR /test

RUN echo "========================================" && \
    echo "Testing npx agentic-flow@1.7.8" && \
    echo "========================================" && \
    npx agentic-flow@1.7.8 --version 2>&1 | head -20

CMD ["echo", "✅ Test complete"]
