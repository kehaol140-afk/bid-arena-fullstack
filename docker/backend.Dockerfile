# Bid Arena backend image (multi-stage).
# Build context = repo root (compose: context ., dockerfile docker/backend.Dockerfile).
# Runtime: thin jar + lib/* on classpath, ports 8090 (HTTP) / 8091 (WS) per backend app.yml.
# Flyway migration + idempotent seed run automatically on boot (DatabaseInitializer).

FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
COPY backend/pom.xml ./pom.xml
# pre-fetch dependencies for layer caching (best effort; offline builds tolerate failure)
RUN mvn -q -DskipTests dependency:go-offline || true
COPY backend/src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:17-jre
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/target/bid-arena-backend.jar /app/app.jar
COPY --from=build /src/target/lib /app/lib
# defaults point at the compose "mysql" service; override via env (.env)
ENV BID_DB_URL="jdbc:mysql://mysql:3306/bid_arena?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC" \
    BID_DB_USER=root \
    BID_DB_PASSWORD=change-me \
    BID_DB_POOL_MAX=20
EXPOSE 8090 8091
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
  CMD curl -fsS "http://127.0.0.1:8090/api/v1/health" | grep -q '"status":"UP"' || exit 1
ENTRYPOINT ["java", "-cp", "app.jar:lib/*", "com.bidarena.App"]
