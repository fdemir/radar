// Findings support inline bold only. HTML and other Markdown remain plain text.
export function inlineEmphasis(text: string) {
  return text.split(/\*\*([^*\n]+)\*\*/g).map((text, index) => ({
    text,
    bold: index % 2 === 1,
  }));
}

export function plainText(text: string) {
  return inlineEmphasis(text)
    .map((part) => part.text)
    .join("");
}
