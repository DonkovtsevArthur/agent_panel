/**
 * Защита от runaway-ответов модели: зацикливания и чрезмерной длины.
 */
export function sanitizeAssistantText(
  input: string,
  options?: { maxChars?: number }
): string {
  const maxChars = options?.maxChars ?? 12_000;
  let text = (input ?? "").trim();
  if (!text) {
    return text;
  }

  let collapsed = false;

  // 1) Одинаковые строки подряд
  {
    const lines = text.split("\n");
    const out: string[] = [];
    let prev = "\u0000";
    let streak = 0;
    for (const line of lines) {
      if (line === prev) {
        streak += 1;
        if (streak <= 2) {
          out.push(line);
        } else {
          collapsed = true;
        }
      } else {
        prev = line;
        streak = 1;
        out.push(line);
      }
    }
    text = out.join("\n");
  }

  // 2) Повтор одного и того же фрагмента (в т.ч. через запятую)
  {
    const tokens = text
      .split(/,\s*/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length >= 24) {
      const freq = new Map<string, number>();
      for (const token of tokens) {
        const key = token.slice(0, 120);
        freq.set(key, (freq.get(key) ?? 0) + 1);
      }
      let top = "";
      let topCount = 0;
      for (const [key, count] of freq) {
        if (count > topCount) {
          top = key;
          topCount = count;
        }
      }
      if (topCount >= 20 && topCount / tokens.length >= 0.45) {
        collapsed = true;
        const preview = top.length > 80 ? `${top.slice(0, 80)}…` : top;
        text = `Модель зациклилась и многократно повторяла «${preview}» (${topCount} раз).\nПопробуйте другую модель или переформулируйте запрос.`;
      }
    }
  }

  // 3) Повтор подряд идущего куска текста (lazy unit 8..80)
  if (!collapsed && text.length >= 200) {
    const repeat = text.match(/([\s\S]{8,80}?)\1{6,}/);
    if (repeat?.[1]) {
      collapsed = true;
      const unit = repeat[1];
      const preview = unit.length > 80 ? `${unit.slice(0, 80)}…` : unit;
      text = `${unit}${unit}\n\n[ответ обрезан: повтор «${preview.trim()}»]`;
    }
  }

  // 4) Лимит длины
  if (text.length > maxChars) {
    text =
      text.slice(0, maxChars).trimEnd() +
      "\n\n[ответ обрезан по длине]";
  } else if (collapsed && !text.includes("[ответ обрезан") && !text.includes("зациклилась")) {
    text += "\n\n[ответ обрезан: обнаружен повтор]";
  }

  return text.trim();
}
