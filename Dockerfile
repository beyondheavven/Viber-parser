# syntax=docker/dockerfile:1.7
FROM eclipse-temurin:21-jdk-jammy AS build
WORKDIR /app

# Pinned so the cache mount below always lands on the same directory: without
# it Gradle picks $HOME/.gradle, which differs between base images and silently
# turns the cache into a no-op.
ENV GRADLE_USER_HOME=/cache/gradle

COPY gradlew ./
COPY gradle ./gradle
COPY build.gradle.kts settings.gradle.kts gradle.properties* ./
RUN sed -i 's/\r$//' gradlew && chmod +x gradlew

# Resolve dependencies before src is copied. The cache mount already survives
# across builds; this extra layer keeps an *unchanged* dependency set from even
# re-running Gradle's resolution when only src moved.
RUN --mount=type=cache,target=/cache/gradle \
    ./gradlew --no-daemon --build-cache dependencies

COPY src ./src

# GRADLE_USER_HOME holds the wrapper distribution, the Maven module cache and
# the Gradle build cache, so a src-only change recompiles and reuses the rest.
RUN --mount=type=cache,target=/cache/gradle \
    ./gradlew --no-daemon --build-cache buildFatJar

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      android-tools-adb \
      curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /app/build/libs/*-all.jar app.jar

RUN mkdir -p /apk

COPY start.sh /app/start.sh
COPY install_apk.sh /app/install_apk.sh
COPY fix_gapps.sh /app/fix_gapps.sh
RUN sed -i 's/\r$//' /app/start.sh /app/install_apk.sh /app/fix_gapps.sh && chmod +x /app/start.sh /app/install_apk.sh /app/fix_gapps.sh

EXPOSE 8080

CMD ["/app/start.sh"]
