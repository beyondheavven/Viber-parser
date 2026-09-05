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
    rm -rf /var/lib/apt/lists/* \

COPY --from=build /app/build/libs/*-all.jar app.jar

EXPOSE 8080

CMD ["sh", "-c", "adb wait-for-device && \
                      until [ \"\$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\\r')\" = \"1\" ]; do sleep 5; done && \
                      echo 'The emulator has been loaded. Connecting: \${ADB_HOST}:\${ADB_PORT}' && \
                      adb connect \${ADB_HOST}:\${ADB_PORT} && \
                      adb root && \
                      echo '--> Installing Frida...' && \
                      curl -L -o /tmp/frida-server https://github.com/frida/frida/releases/download/16.1.4/frida-server-16.1.4-android-x86_64 && \
                      adb push /tmp/frida-server /data/local/tmp/frida-server && \
                      adb shell chmod 755 /data/local/tmp/frida-server && \
                      echo '--> Launching Frida-server...' && \
                      adb shell 'nohup /data/local/tmp/frida-server > /dev/null 2>&1 &' && \
                      echo '--> Start Ktor API...' && \
                      exec java -Dfile.encoding=UTF-8 -jar /app/app.jar"]