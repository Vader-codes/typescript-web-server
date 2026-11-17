import * as fs from "fs/promises";
import { BodyReader } from "./http_types";

export async function readerFromFile(
  path: string,
  start: number = 0,
  end: number = -1,
): Promise<BodyReader> {
  const fp = await fs.open(path, "r");
  const stat = await fp.stat();
  if (!stat.isFile()) {
    await fp.close();
    throw new Error("not a regular file");
  }

  const size = stat.size;
  // If end is -1, read to the end of the file.
  if (end < 0) {
    end = size;
  }
  // Clamp the end to the file size.
  end = Math.min(end, size);
  // Clamp the start.
  start = Math.max(0, start);

  // The total length of the slice.
  const totalLength = end - start;
  let offset = start;

  return {
    length: totalLength,
    read: async (): Promise<Buffer> => {
      // If we've read the whole slice, return EOF.
      if (offset >= end) {
        return Buffer.from("");
      }

      // Read a chunk, but no more than what's left in the slice.
      const chunkSize = Math.min(65536, end - offset);
      const buf = Buffer.alloc(chunkSize);
      const result = await fp.read(buf, 0, chunkSize, offset);
      offset += result.bytesRead;

      return buf.subarray(0, result.bytesRead);
    },
    close: async () => {
      await fp.close();
    },
  };
}
