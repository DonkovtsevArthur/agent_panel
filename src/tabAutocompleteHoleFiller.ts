/**
 * Hole-fill prompts adapted from TabCoder (Apache-2.0)
 * vendor/tabcoder/src/autocomplete/defaultHoleFiller.ts
 * Original inspiration: Continue holeFillerTemplate / VictorTaelin AI-scripts.
 */

export type AutoCompleteContext = {
  textBeforeCursor: string;
  textAfterCursor: string;
  currentLineText: string;
  filename?: string;
  language?: string;
};

export type HoleFillPromptMessage = {
  role: "system" | "user";
  content: string;
};

export class DefaultHoleFiller {
  systemPrompt(): string {
    return `You are a HOLE FILLER. You are provided with a file containing holes, formatted as '{{HOLE_NAME}}'.
		Your TASK is to complete with a string to replace this hole with, inside a <COMPLETION/> XML tag, including context-aware indentation, if needed.
		All completions MUST be truthful, accurate, well-written and correct.
## EXAMPLE QUERY:

<QUERY>
function sum_evens(lim) {
  var sum = 0;
  for (var i = 0; i < lim; ++i) {
    {{FILL_HERE}}
  }
  return sum;
}
</QUERY>

TASK: Fill the {{FILL_HERE}} hole.

## CORRECT COMPLETION

<COMPLETION>if (i % 2 === 0) {
      sum += i;
    }</COMPLETION>

## EXAMPLE QUERY:

<QUERY>
def sum_list(lst):
  total = 0
  for x in lst:
  {{FILL_HERE}}
  return total

print sum_list([1, 2, 3])
</QUERY>

## CORRECT COMPLETION:

<COMPLETION>  total += x</COMPLETION>

## EXAMPLE QUERY:

<QUERY>
// data Tree a = Node (Tree a) (Tree a) | Leaf a

// sum :: Tree Int -> Int
// sum (Node lft rgt) = sum lft + sum rgt
// sum (Leaf val)     = val

// convert to TypeScript:
{{FILL_HERE}}
</QUERY>

## CORRECT COMPLETION:

<COMPLETION>type Tree<T>
  = {$:"Node", lft: Tree<T>, rgt: Tree<T>}
  | {$:"Leaf", val: T};

function sum(tree: Tree<number>): number {
  switch (tree.$) {
    case "Node":
      return sum(tree.lft) + sum(tree.rgt);
    case "Leaf":
      return tree.val;
  }
}</COMPLETION>

## EXAMPLE QUERY:

The 5th {{FILL_HERE}} is Jupiter.

## CORRECT COMPLETION:

<COMPLETION>planet from the Sun</COMPLETION>

## EXAMPLE QUERY:

function hypothenuse(a, b) {
  return Math.sqrt({{FILL_HERE}}b ** 2);
}

## CORRECT COMPLETION:

<COMPLETION>a ** 2 + </COMPLETION>
`;
  }

  userPrompt(ctx: AutoCompleteContext): string {
    let context = "";
    if (ctx.filename) {
      context += `// Filename: "${ctx.filename}" \n`;
    }
    if (ctx.language) {
      context += `// Programming language: "${ctx.language}" \n`;
    }
    const sameLineSuffix = (ctx.textAfterCursor.split("\n")[0] || "");
    const guidance =
      sameLineSuffix.length > 0
        ? "Prefer a SHORT completion that finishes the current line only (no newlines). Do not rewrite or repeat text after {{FILL_HERE}}."
        : "Prefer a SHORT, high-confidence completion (a few tokens up to a few lines). Do not invent large unrelated blocks.";
    return `${context}<QUERY>\n${ctx.textBeforeCursor}{{FILL_HERE}}${ctx.textAfterCursor}\n</QUERY>\nTASK: Fill the {{FILL_HERE}} hole. ${guidance} Answer only with the CORRECT completion inside the tag, and NOTHING ELSE. Do it now.\n<COMPLETION>`;
  }

  prompt(params: AutoCompleteContext): { messages: HoleFillPromptMessage[] } {
    return {
      messages: [
        { role: "system", content: this.systemPrompt() },
        { role: "user", content: this.userPrompt(params) },
      ],
    };
  }
}

/** Strip optional COMPLETION XML wrapper from model output (TabCoder). */
export function processHoleFillResponse(responseText: string): string {
  const fullMatch = /(<COMPLETION>)?([\s\S]*?)(<\/COMPLETION>|$)/.exec(
    responseText
  );
  if (!fullMatch) {
    return responseText;
  }
  if (fullMatch[2].endsWith("</COMPLETION>")) {
    return fullMatch[2].slice(0, -"</COMPLETION>".length);
  }
  return fullMatch[2];
}

/**
 * Clean model output into insertable ghost text.
 * - strip fences / echoed line
 * - drop overlap with suffix after cursor
 * - keep single-line when cursor is mid-line
 */
export function refineCompletionText(
  raw: string,
  ctx: AutoCompleteContext
): string {
  let response = processHoleFillResponse(raw).replace(/\r\n/g, "\n");
  if (response.startsWith(ctx.currentLineText)) {
    response = response.slice(ctx.currentLineText.length);
  }
  response = response.replace(/^```[\w-]*\n?/, "").replace(/\n?```$/, "");

  const sameLineSuffix = (ctx.textAfterCursor.split("\n")[0] || "");
  if (sameLineSuffix.length > 0) {
    // Mid-line: only the first line of the suggestion.
    response = response.split("\n")[0] || "";
    // If model echoed the upcoming suffix, trim the overlap.
    while (response.length > 0 && sameLineSuffix.startsWith(response)) {
      // suggestion is already fully present after cursor — useless
      return "";
    }
    for (let n = Math.min(response.length, sameLineSuffix.length); n > 0; n--) {
      if (response.endsWith(sameLineSuffix.slice(0, n))) {
        response = response.slice(0, response.length - n);
        break;
      }
    }
  } else {
    // Trim leading overlap with following lines when model repeats them.
    const suffixStart = ctx.textAfterCursor.slice(0, 80);
    if (suffixStart && response.includes(suffixStart.trimStart().slice(0, 20))) {
      const idx = response.indexOf(suffixStart.trimStart().slice(0, 20));
      if (idx > 0) {
        response = response.slice(0, idx);
      }
    }
  }

  return response;
}
