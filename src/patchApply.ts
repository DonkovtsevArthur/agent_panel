export type SearchReplaceErrorCode =
  | "EMPTY_OLD_STRING"
  | "NO_MATCH"
  | "MULTIPLE_MATCHES"
  | "NO_CHANGE";

export interface SearchReplaceError {
  code: SearchReplaceErrorCode;
  message: string;
  matchCount: number;
}

export type SearchReplaceResult =
  | {
      ok: true;
      content: string;
      replacements: number;
    }
  | {
      ok: false;
      unchanged?: true;
      error: SearchReplaceError;
    };

interface NormalizedText {
  text: string;
  /** Maps every normalized string boundary back to the original string. */
  originalOffsets: number[];
}

function normalizeCrLfWithOffsets(input: string): NormalizedText {
  let text = "";
  const originalOffsets = [0];
  let offset = 0;
  while (offset < input.length) {
    if (input[offset] === "\r" && input[offset + 1] === "\n") {
      text += "\n";
      offset += 2;
    } else {
      text += input[offset];
      offset += 1;
    }
    originalOffsets.push(offset);
  }
  return { text, originalOffsets };
}

function dominantLineEnding(input: string): "\r\n" | "\n" {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < input.length; i += 1) {
    if (input[i] !== "\n") {
      continue;
    }
    if (i > 0 && input[i - 1] === "\r") {
      crlf += 1;
    } else {
      lf += 1;
    }
  }
  return crlf > lf ? "\r\n" : "\n";
}

function replacementForMatch(
  replacement: string,
  matchedOriginal: string,
  fallbackEnding: "\r\n" | "\n"
): string {
  const localEnding = matchedOriginal.match(/\r\n|\n/)?.[0] as
    | "\r\n"
    | "\n"
    | undefined;
  const ending = localEnding ?? fallbackEnding;
  return replacement.replace(/\r\n/g, "\n").replace(/\n/g, ending);
}

function failure(
  code: SearchReplaceErrorCode,
  message: string,
  matchCount: number,
  unchanged = false
): SearchReplaceResult {
  return {
    ok: false,
    ...(unchanged ? { unchanged: true as const } : {}),
    error: { code, message, matchCount },
  };
}

/**
 * Applies an exact text replacement without filesystem or VS Code dependencies.
 * LF snippets also match CRLF files, while untouched text keeps its original EOLs.
 */
export function applySearchReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false
): SearchReplaceResult {
  if (!oldString) {
    return failure(
      "EMPTY_OLD_STRING",
      "old_string must not be empty.",
      0
    );
  }

  const source = normalizeCrLfWithOffsets(content);
  const needle = oldString.replace(/\r\n/g, "\n");
  const replacement = newString.replace(/\r\n/g, "\n");
  const matches: number[] = [];
  let from = 0;
  while (from <= source.text.length - needle.length) {
    const found = source.text.indexOf(needle, from);
    if (found < 0) {
      break;
    }
    matches.push(found);
    from = found + needle.length;
  }

  if (matches.length === 0) {
    return failure(
      "NO_MATCH",
      "old_string was not found in the file.",
      0
    );
  }
  if (!replaceAll && matches.length > 1) {
    return failure(
      "MULTIPLE_MATCHES",
      "old_string is not unique; provide more context or set replace_all.",
      matches.length
    );
  }

  const selected = replaceAll ? matches : matches.slice(0, 1);
  const fallbackEnding = dominantLineEnding(content);
  let result = content;
  for (let i = selected.length - 1; i >= 0; i -= 1) {
    const normalizedStart = selected[i];
    const normalizedEnd = normalizedStart + needle.length;
    const originalStart = source.originalOffsets[normalizedStart];
    const originalEnd = source.originalOffsets[normalizedEnd];
    const matchedOriginal = content.slice(originalStart, originalEnd);
    const adaptedReplacement = replacementForMatch(
      replacement,
      matchedOriginal,
      fallbackEnding
    );
    result =
      result.slice(0, originalStart) +
      adaptedReplacement +
      result.slice(originalEnd);
  }

  if (result === content) {
    return failure(
      "NO_CHANGE",
      "Replacement would not change the file.",
      matches.length,
      true
    );
  }

  return {
    ok: true,
    content: result,
    replacements: selected.length,
  };
}
