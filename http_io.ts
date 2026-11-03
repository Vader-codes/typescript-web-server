import { TCPConn, soRead } from "./net_io";
import { DynBuf, bufPush, bufPop } from "./dynbuf";
import { HTTPReq, HTTPRes, BodyReader } from "./http_types";
import { HTTPError } from "./http_parser";

// Find a header value by name (case-insensitive).
export function fieldGet(headers: Buffer[], key: string): null | Buffer {
  // We convert the key to lowercase for comparison.
  const lowerKey = key.toLowerCase();

  for (const h of headers) {
    // Find the colon that separates name from value.
    const idx = h.indexOf(":");
    if (idx < 0) continue;

    // Extract the name and trim whitespace.
    const name = h.subarray(0, idx).toString("latin1").trim();

    if (name.toLowerCase() === lowerKey) {
      // Extract the value and trim whitespace.
      const val = h
        .subarray(idx + 1)
        .toString("latin1")
        .trim();
      return Buffer.from(val);
    }
  }
  return null; // Not found
}

// Creates a BodyReader based on the request headers.
export function readerFromReq(
  conn: TCPConn,
  buf: DynBuf,
  req: HTTPReq,
): BodyReader {
  let bodyLen = -1;

  // 1. Check for Content-Length.
  const contentLen = fieldGet(req.headers, "Content-Length");
  if (contentLen) {
    bodyLen = parseInt(contentLen.toString("latin1"), 10);
    if (isNaN(bodyLen)) {
      throw new HTTPError(400, "bad Content-Length");
    }
  }

  // 2. GET and HEAD are not allowed to have a body.
  const bodyAllowed = !(req.method === "GET" || req.method === "HEAD");
  if (!bodyAllowed && bodyLen > 0) {
    throw new HTTPError(400, "HTTP body not allowed");
  }
  if (!bodyAllowed) {
    bodyLen = 0;
  }

  // 3. If we don't know the length, we can't handle it yet.
  // (Chunked encoding comes in Chapter 8).
  if (bodyLen < 0) {
    throw new HTTPError(411, "Content-Length required");
  }

  // 4. Return the BodyReader.
  return readerFromConnLength(conn, buf, bodyLen);
}

// A BodyReader that reads exactly `remain` bytes from the socket/buffer.
function readerFromConnLength(
  conn: TCPConn,
  buf: DynBuf,
  remain: number,
): BodyReader {
  return {
    length: remain,
    read: async (): Promise<Buffer> => {
      // If we are done, return an empty buffer (EOF).
      if (remain === 0) {
        return Buffer.from("");
      }

      // If the buffer is empty, read more from the socket.
      if (buf.length === 0) {
        const data = await soRead(conn);
        bufPush(buf, data);
        if (data.length === 0) {
          throw new Error("Unexpected EOF from HTTP body");
        }
      }

      // Consume from the buffer, but no more than `remain`.
      const consume = Math.min(buf.length, remain);
      remain -= consume;

      // Copy the consumed bytes into a new buffer.
      const data = Buffer.from(buf.data.subarray(0, consume));
      bufPop(buf, consume);

      return data;
    },
  };
}

// A BodyReader that reads from an in-memory buffer.
export function readerFromMemory(data: Buffer): BodyReader {
  let done = false;
  return {
    length: data.length,
    read: async (): Promise<Buffer> => {
      if (done) {
        return Buffer.from(""); // EOF
      }
      done = true;
      return data; // Send the whole buffer once
    },
  };
}
