import * as fs from "fs/promises";
import { BodyReader } from "./http_types";

// Opens a file and returns a BodyReader that streams it.
export async function readerFromFile(path: string): Promise<BodyReader> {
  // Open the file (throws if it doesn't exist or can't be read).
  const fp = await fs.open(path, "r");

  // Get the file metadata.
  const stat = await fp.stat();
  if (!stat.isFile()) {
    await fp.close();
    throw new Error("not a regular file");
  }

  const size = stat.size;
  let offset = 0;

  return {
    length: size,
    read: async (): Promise<Buffer> => {
      // If we've read the whole file, return EOF.
      if (offset >= size) {
        return Buffer.from("");
      }

      // Read a chunk from the file.
      const chunkSize = Math.min(65536, size - offset); // 64KB chunks
      const buf = Buffer.alloc(chunkSize);
      const result = await fp.read(buf, 0, chunkSize, offset);

      offset += result.bytesRead;

      // Return the actual bytes read.
      return buf.subarray(0, result.bytesRead);
    },
    close: async () => {
      // Close the file handle when we're done.
      await fp.close();
    },
  };
}
