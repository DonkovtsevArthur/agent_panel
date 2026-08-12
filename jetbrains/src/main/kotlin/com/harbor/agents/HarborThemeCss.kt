package com.harbor.agents

import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.ui.JBColor
import com.intellij.util.ui.UIUtil
import java.awt.Color

/**
 * VS Code webviews get `--vscode-*` from the host. JetBrains JCEF does not —
 * without them `panel.css` falls back to light defaults (`#ffffff`) and the UI
 * looks unlike the VS Code panel.
 */
object HarborThemeCss {
  fun rootVariables(): String {
    val scheme = try {
      EditorColorsManager.getInstance().globalScheme
    } catch (_: Throwable) {
      null
    }
    val editorBg = scheme?.defaultBackground ?: JBColor.background()
    val editorFg = scheme?.defaultForeground ?: JBColor.foreground()
    val dark = isDark(editorBg)
    val sideBg = try {
      UIUtil.getPanelBackground()
    } catch (_: Throwable) {
      editorBg
    }
    val inputBg = try {
      UIUtil.getTextFieldBackground()
    } catch (_: Throwable) {
      mix(editorFg, editorBg, if (dark) 0.06 else 0.04)
    }
    val border = JBColor.border()
    val focus = JBColor(Color(0x00, 0x7f, 0xd4), Color(0x00, 0x7f, 0xd4))
    val link = JBColor(Color(0x00, 0x6a, 0xb1), Color(0x37, 0x9d, 0xff))
    val linkActive = JBColor(Color(0x00, 0x5a, 0x9e), Color(0x4e, 0xb2, 0xff))
    val btnBg = JBColor(Color(0x0e, 0x63, 0x9c), Color(0x0e, 0x63, 0x9c))
    val btnFg = Color.WHITE
    val error = JBColor(Color(0xe5, 0x14, 0x00), Color(0xf4, 0x87, 0x71))
    val desc = mix(editorFg, editorBg, 0.55)
    val disabled = mix(editorFg, editorBg, 0.38)
    val selectionBg = mix(focus, editorBg, if (dark) 0.45 else 0.28)
    val codeBlock = mix(editorFg, editorBg, if (dark) 0.08 else 0.05)
    val widgetBg = mix(editorFg, editorBg, if (dark) 0.10 else 0.04)
    val hover = mix(editorFg, editorBg, if (dark) 0.10 else 0.06)

    return """
      :root {
        color-scheme: ${if (dark) "dark" else "light"};
        --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        --vscode-font-size: 13px;
        --vscode-editor-font-family: "JetBrains Mono", ui-monospace, Menlo, Monaco, Consolas, monospace;
        --vscode-editor-background: ${css(editorBg)};
        --vscode-editor-foreground: ${css(editorFg)};
        --vscode-foreground: ${css(editorFg)};
        --vscode-descriptionForeground: ${css(desc)};
        --vscode-disabledForeground: ${css(disabled)};
        --vscode-errorForeground: ${css(error)};
        --vscode-sideBar-background: ${css(sideBg)};
        --vscode-sideBar-foreground: ${css(editorFg)};
        --vscode-input-background: ${css(inputBg)};
        --vscode-input-foreground: ${css(editorFg)};
        --vscode-input-border: ${css(border)};
        --vscode-input-placeholderForeground: ${css(desc)};
        --vscode-focusBorder: ${css(focus)};
        --vscode-button-background: ${css(btnBg)};
        --vscode-button-foreground: ${css(btnFg)};
        --vscode-button-secondaryBackground: ${css(mix(editorFg, editorBg, 0.12))};
        --vscode-button-secondaryForeground: ${css(editorFg)};
        --vscode-editorWidget-background: ${css(widgetBg)};
        --vscode-editorWidget-foreground: ${css(editorFg)};
        --vscode-editorWidget-border: ${css(border)};
        --vscode-widget-border: ${css(border)};
        --vscode-widget-shadow: ${css(if (dark) Color(0, 0, 0) else Color(0x60, 0x60, 0x60))};
        --vscode-list-hoverBackground: ${css(hover)};
        --vscode-list-activeSelectionBackground: ${css(selectionBg)};
        --vscode-list-activeSelectionForeground: ${css(editorFg)};
        --vscode-toolbar-hoverBackground: ${css(hover)};
        --vscode-textCodeBlock-background: ${css(codeBlock)};
        --vscode-editorGroup-border: ${css(border)};
        --vscode-panel-border: ${css(border)};
        --vscode-textLink-foreground: ${css(link)};
        --vscode-textLink-activeForeground: ${css(linkActive)};
        --vscode-editor-selectionBackground: ${css(selectionBg)};
        --vscode-editor-selectionForeground: ${css(editorFg)};
        --vscode-editorLineNumber-foreground: ${css(desc)};
        --vscode-charts-blue: ${css(JBColor(Color(0x1a, 0x85, 0xff), Color(0x37, 0x9d, 0xff)))};
        --vscode-charts-green: ${css(JBColor(Color(0x38, 0x8a, 0x34), Color(0x89, 0xd1, 0x85)))};
        --vscode-charts-orange: ${css(JBColor(Color(0xf5, 0x8a, 0x00), Color(0xe2, 0xa6, 0x64)))};
        --vscode-charts-purple: ${css(JBColor(Color(0x65, 0x2d, 0x90), Color(0xb1, 0x80, 0xd7)))};
        --vscode-charts-yellow: ${css(JBColor(Color(0xbf, 0x88, 0x00), Color(0xe2, 0xc0, 0x8d)))};
        --vscode-testing-iconPassed: ${css(JBColor(Color(0x38, 0x8a, 0x34), Color(0x89, 0xd1, 0x85)))};
        --vscode-debugTokenExpression-boolean: ${css(JBColor(Color(0x00, 0x00, 0xff), Color(0x56, 0x9c, 0xd6)))};
        --vscode-debugTokenExpression-string: ${css(JBColor(Color(0xa3, 0x15, 0x15), Color(0xce, 0x91, 0x78)))};
        --vscode-debugTokenExpression-number: ${css(JBColor(Color(0x09, 0x86, 0x58), Color(0xb5, 0xce, 0xa8)))};
        --vscode-symbolIcon-keywordForeground: ${css(link)};
        --vscode-symbolIcon-booleanForeground: ${css(JBColor(Color(0x00, 0x00, 0xff), Color(0x56, 0x9c, 0xd6)))};
        --vscode-symbolIcon-stringForeground: ${css(JBColor(Color(0xa3, 0x15, 0x15), Color(0xce, 0x91, 0x78)))};
        --vscode-symbolIcon-numberForeground: ${css(JBColor(Color(0x09, 0x86, 0x58), Color(0xb5, 0xce, 0xa8)))};
        --vscode-symbolIcon-classForeground: ${css(editorFg)};
        --vscode-symbolIcon-functionForeground: ${css(editorFg)};
        --harbor-chat-bg: ${css(editorBg)};
        --harbor-bubble-bg: ${css(sideBg)};
      }
      html, body {
        background: ${css(editorBg)} !important;
        color: ${css(editorFg)} !important;
      }
    """.trimIndent()
  }

  private fun css(c: Color): String {
    return "#%02x%02x%02x".format(c.red, c.green, c.blue)
  }

  private fun isDark(bg: Color): Boolean {
    val l = (0.2126 * bg.red + 0.7152 * bg.green + 0.0722 * bg.blue) / 255.0
    return l < 0.5
  }

  private fun mix(fg: Color, bg: Color, amount: Double): Color {
    val a = amount.coerceIn(0.0, 1.0)
    return Color(
      (bg.red + (fg.red - bg.red) * a).toInt().coerceIn(0, 255),
      (bg.green + (fg.green - bg.green) * a).toInt().coerceIn(0, 255),
      (bg.blue + (fg.blue - bg.blue) * a).toInt().coerceIn(0, 255),
    )
  }
}
