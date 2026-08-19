plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.0.21"
    id("org.jetbrains.intellij.platform") version "2.5.0"
}

group = "com.harbor.agents"
version = "2.0.16"

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
        // PSI / codeInsight are platform APIs (com.intellij.modules.platform);
        // no Java-specific dependency needed — keeps the plugin installable in
        // Rider, GoLand, PyCharm, etc.
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "com.harbor.agents"
        name = "Harbor Agents"
        version = project.version.toString()
        ideaVersion {
            // WebStorm / IU 2025.2+ (252). JCEF may be platform-bundled (252)
            // or a separate plugin / content modules (253+ / 2026.2+).
            sinceBuild = "252.23892"
            untilBuild.set(provider { null })
        }
        description.set(
            """
            <p><b>Harbor Agents</b> (Гавань агентов) — локальная панель AI-агента для WebStorm / IntelliJ.
            Подключаете свой OpenAI-compatible API: чаты и настройки остаются на вашей машине, без облака Harbor.</p>

            <h3>Возможности</h3>
            <ul>
              <li><b>Режимы Agent / Plan / Ask</b> — правки и терминал, план без правок, вопросы по коду</li>
              <li><b>Свой провайдер</b> — OpenAI, Azure, корпоративные gateway, локальные модели</li>
              <li><b>Инструменты</b> — поиск по проекту, чтение и правка файлов, команды в терминале</li>
              <li><b>Контекст из IDE</b> — добавить выделение или файл в чат (контекстное меню и хоткеи)</li>
              <li><b>MCP</b> — Figma и свои серверы (stdio / HTTP)</li>
              <li><b>Review и Git</b> — карточки diff, генерация commit message, commit &amp; push из панели</li>
              <li><b>Сессии локально</b> — чаты хранятся в проекте (<code>.idea/harbor</code>)</li>
            </ul>

            <h3>Быстрый старт</h3>
            <ol>
              <li>Откройте tool window <b>Harbor Agents</b></li>
              <li>Settings → добавьте провайдера (<code>baseUrl</code>, <code>apiKey</code>) и модели</li>
              <li>Выделите код → <b>⇧⌘L</b> / <b>Ctrl+Shift+L</b> — добавить в чат</li>
              <li>Файл → <b>⇧⌘H</b> / <b>Ctrl+Shift+H</b> — добавить файл в чат</li>
            </ol>

            <h3>Требования</h3>
            <ul>
              <li>WebStorm / IntelliJ <b>2025.2+</b> (build 252+) с JCEF / Web Browser</li>
              <li>Node.js для sidecar-рантайма агента</li>
              <li>OpenAI-compatible API и хотя бы один model id</li>
            </ul>
            """.trimIndent()
        )
        changeNotes.set(
            """
            <b>2.0.10</b>
            <ul>
              <li>Prompt cache — чекбокс заменён на свитч (toggle), перевод на русский</li>
              <li>Prompt cache по умолчанию включён для всех провайдеров (включая существующие)</li>
              <li>Исправлено сохранение prompt cache — настройка больше не теряется при перезапуске</li>
            </ul>
            <b>2.0.6</b>
            <ul>
              <li>Провайдеры и модели хранятся глобально (<code>~/.harbor/settings.json</code>) — доступны всем проектам</li>
              <li>Чаты остаются per-project в <code>.idea/harbor</code></li>
            </ul>
            <b>1.5.145</b>
            <ul>
              <li>Мягкие цветные бордеры пузыря пользователя и композа по режиму; фон пузыря без изменений</li>
            </ul>
            <b>1.5.143</b>
            <ul>
              <li>Интеллект (reasoning) для Kimi и GLM-4.5+/5.x, не только Claude</li>
            </ul>
            <b>1.5.141</b>
            <ul>
              <li>Настройки: селекты как выбор режима в композе; попап не закрывается сразу</li>
            </ul>
            <b>1.5.138</b>
            <ul>
              <li>WebStorm: убран JS-скролл — снова нативное колесо JCEF, без задержки</li>
            </ul>
            <b>1.5.137</b>
            <ul>
              <li>WebStorm: скролл без замедления — полная дельта за кадр, без доезда</li>
            </ul>
            <b>1.5.136</b>
            <ul>
              <li>WebStorm: скролл мягче, но без «низкого FPS» — шаг сразу, короткий доезд</li>
            </ul>
            <b>1.5.135</b>
            <ul>
              <li>WebStorm: мягче скролл в чате, Settings и меню (JCEF OSR)</li>
            </ul>
            <b>1.5.134</b>
            <ul>
              <li>Ветки чата: вкладки как в браузере, подпись из промпта, имя форка сразу лёгкой моделью на языке из Settings</li>
            </ul>
            <b>1.5.115</b>
            <ul>
              <li>В статусе «Думаю...» короткое имя модели (GLM 5.2)</li>
            </ul>
            <b>1.5.114</b>
            <ul>
              <li>Авто-имя чата лёгкой моделью; ручное имя не перезаписывается</li>
              <li>Превью картинок в истории; пузырь по ширине текста; шаги — чип; короткое имя модели в композере</li>
              <li>Ветки: пилюли Main / ·2; rename агента в WebStorm больше не теряется</li>
            </ul>
            <b>1.5.113</b>
            <ul>
              <li>GLM без vision: описание картинки под капотом; повторный проход только если вопрос про скрин; inspect_images вместо spawn_agent</li>
              <li>Простаивающие Cline-сессии выгружаются при смене чата</li>
            </ul>
            <b>1.4.113</b>
            <ul>
              <li>Settings → Поведение агента: свёрнутый промпт, лимиты в ряд, группы Выполнение / Интерфейс и switch-ряды</li>
            </ul>
            <b>1.3.113</b>
            <ul>
              <li>GLM vision: не подменять картинки Cline, только ставить их перед текстом</li>
            </ul>
            <b>1.2.113</b>
            <ul>
              <li>GLM + картинка: не клеим dump редактора, пиксели первыми в chat/completions</li>
            </ul>
            <b>1.1.113</b>
            <ul>
              <li>GLM на форке: картинки уходят в chat/completions (обход каталога Cline без images)</li>
            </ul>
            <b>1.1.112</b>
            <ul>
              <li>Форк чата: картинки доходят до модели (форма Cline ImageContent, пиксели на последнем ходе)</li>
            </ul>
            <b>1.1.111</b>
            <ul>
              <li>GLM-5.2: картинки на форке и следующем ходе (capability images)</li>
            </ul>
            <b>1.1.110</b>
            <ul>
              <li>WebStorm: снимок редактора на EDT (файл/курсор/терминал не теряются, когда фокус в чате); UI и sidecar из плагина, не из user.dir</li>
            </ul>
            <b>1.1.103</b>
            <ul>
              <li>Фикс кнопки «отправить» в композере и при редактировании сообщения (клик по иконке в webview)</li>
            </ul>
            <b>1.1.97</b>
            <ul>
              <li>Контекст хода: терминал/Run, символ у курсора, git ahead/behind, правила по файлу; картинки в истории; чекпоинты и подтверждение tools</li>
            </ul>
            <b>1.1.96</b>
            <ul>
              <li>Контекст хода из IDE: открытый файл, курсор, выделение, диагностики; живая Cline-сессия на чат; MCP у субагентов</li>
              <li>Прикрепить файл из чата: пункт «Файл» в меню +</li>
            </ul>
            <b>1.1.95</b>
            <ul>
              <li>Прикрепить файл из чата: пункт «Файл» в меню +, диалог выбора если нет открытого файла</li>
            </ul>
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
