plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.0.21"
    id("org.jetbrains.intellij.platform") version "2.5.0"
}

group = "com.harbor.agents"
version = "0.1.41"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.2.1")
        instrumentationTools()
        // Platform ships kotlin-stdlib; don't bundle a second copy
        bundledPlugin("com.intellij.java")
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "com.harbor.agents"
        name = "Harbor Agents"
        version = project.version.toString()
        ideaVersion {
            // com.intellij.modules.jcef alias exists since 2025.3.1; required for 2026.2+
            sinceBuild = "253.2430"
            untilBuild.set(provider { null })
        }
        description.set(
            """
            Harbor Agents for WebStorm / IntelliJ: chat with Agent / Plan / Ask modes,
            providers, MCP, and commit-from-review. Shares the webview UI and Node
            sidecar core with the VS Code Harbor Agents extension.
            """.trimIndent()
        )
    }
    // Avoid ASM instrumentCode crashes on some Gradle/plugin combos
    instrumentCode = false
    buildSearchableOptions = false
}

kotlin {
    jvmToolchain(21)
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.register<Copy>("prepareHarborResources") {
    description = "Copy shared webview media (+ sidecar + cline bundle) into build resources"
    into(layout.buildDirectory.dir("resources/main/harbor"))
    from(rootProject.projectDir.resolve("../media")) {
        into("media")
    }
    val outDir = rootProject.projectDir.resolve("../out")
    val sidecar = outDir.resolve("harborSidecar.js")
    if (sidecar.exists()) {
        from(sidecar) { into("sidecar") }
        val map = outDir.resolve("harborSidecar.js.map")
        if (map.exists()) {
            from(map) { into("sidecar") }
        }
    }
    val cline = outDir.resolve("clineBundle.js")
    if (cline.exists()) {
        from(cline) { into("sidecar") }
    }
}

tasks.named("processResources") {
    dependsOn("prepareHarborResources")
}

tasks.named("prepareSandbox") {
    dependsOn("prepareHarborResources")
}
