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
      curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /app/build/libs/*-all.jar app.jar

COPY apk/viber.apk /apk/viber.apk

COPY start.sh /app/start.sh
COPY install_apk.sh /app/install_apk.sh
RUN chmod +x /app/start.sh /app/install_apk.sh

EXPOSE 8080

CMD ["/app/start.sh"]
