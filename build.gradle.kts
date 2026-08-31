plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.plugin.serialization)
    alias(ktorLibs.plugins.ktor)
}

group = "com.viber"
version = "1.0.0-SNAPSHOT"

application {
    mainClass = "io.ktor.server.netty.EngineMain"
}

kotlin {
    jvmToolchain(21)
}
dependencies {
    implementation(ktorLibs.server.config.yaml)
    implementation(ktorLibs.server.core)
    implementation(ktorLibs.server.netty)
    implementation(ktorLibs.server.contentNegotiation)
    implementation(ktorLibs.serialization.kotlinx.json)
    implementation(ktorLibs.server.statusPages)
    implementation(ktorLibs.server.callLogging)
    implementation(libs.logback.classic)

    implementation("io.appium:java-client:9.3.0")
    implementation("org.seleniumhq.selenium:selenium-java:4.23.0")
    implementation("io.ktor:ktor-server-content-negotiation:3.5.2")

    testImplementation(kotlin("test"))
    testImplementation(ktorLibs.server.testHost)
}
