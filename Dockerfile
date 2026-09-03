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

COPY --from=build /app/build/libs/*-all.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-Dfile.encoding=UTF-8", "-jar", "app.jar"]