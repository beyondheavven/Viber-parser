FROM gradle:8.10-jdk21 AS build
WORKDIR /app

COPY gradlew ./
COPY gradle ./gradle
COPY build.gradle.kts settings.gradle.kts gradle.properties* ./
RUN chmod +x gradlew

COPY src ./src
COPY gradle/libs.versions.toml ./gradle/libs.versions.toml

RUN ./gradlew buildFatJar --no-daemon

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      android-tools-adb \
      python3 \
      python3-pip \
      curl \
      unzip && \
    pip3 install --no-cache-dir frida-tools && \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /app/build/libs/*-all.jar app.jar
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 8080

CMD ["./start.sh"]