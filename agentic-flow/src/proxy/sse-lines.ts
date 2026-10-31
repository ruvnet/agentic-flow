// Shared SSE reader for the translation proxies.
//
// A network read can end anywhere: inside a data: line, or inside a multi-byte
// UTF-8 character. Decoding each read on its own and splitting on '\n' drops
// the split line and corrupts the character. This reader decodes with
// {stream:true} and holds back a partial line until its newline arrives.

/**
 * Read `reader` to the end, calling `onLines` with text made only of complete
 * lines (each ending in '\n'), then once more with any unterminated tail.
 * Returns the number of reads.
 */
export async function forEachSseLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onLines: (lines: string) => void
): Promise<number> {
  const decoder = new TextDecoder();
  let pending = '';
  let reads = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    reads++;

    pending += decoder.decode(value, { stream: true });
    const lastNewline = pending.lastIndexOf('\n');
    if (lastNewline === -1) continue;
    onLines(pending.slice(0, lastNewline + 1));
    pending = pending.slice(lastNewline + 1);
  }

  pending += decoder.decode();
  if (pending.trim()) onLines(pending);
  return reads;
}

/** Non-empty lines of `text`, with any trailing '\r' removed. */
export function sseLines(text: string): string[] {
  return text.split('\n').map(line => line.replace(/\r$/, '')).filter(line => line.trim());
}
