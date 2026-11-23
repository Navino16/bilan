// A response body pulled from `chunks`: the next chunk is only produced once the client has
// read the previous one, so memory stays bounded by one chunk whatever the export size.
export function streamOf(chunks: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const it = chunks[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await it.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    async cancel() {
      await it.return?.();
    },
  });
}
