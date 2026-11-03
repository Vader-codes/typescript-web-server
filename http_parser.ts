import { DynBuf, bufPop } from "./dynbuf";
import { HTTPReq } from "./http_types";

// 8KB limit for the header. Prevent memory exhaustion.
const kMaxHeaderLen = 1024 * 8;

// Thrown when the request is invalid
export class HTTPError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
  }
}

// Tries to pull one full HTTP header out of the buffer.
export function cutMessage(buf: DynBuf): null | HTTPReq {
  // Look for the empty line that marks the end of the header.
  const idx = buf.data.subarray(0, buf.length).indexOf("\r\n\r\n");

  if (idx < 0) {
    // No empty line yet. If the buffer is huge, reject it.
    if (buf.length >= kMaxHeaderLen) {
      throw new HTTPError(413, "header is too large");
    }
    return null; // Need more data
  }

  // We have the full header. Parse it.
  // idx+4 includes the \r\n\r\n itself.
  const msg = parseHTTPReq(buf.data.subarray(0, idx + 4));

  // Remove the header from the buffer.
  bufPop(buf, idx + 4);

  return msg;
}

// Parses the raw header bytes into an HTTPReq object.
function parseHTTPReq(data: Buffer): HTTPReq {
  // Split the header into lines.
  const lines: Buffer[] = splitLines(data);

  // First line is "METHOD URI VERSION".
  const [method, uri, version] = parseRequestLine(lines[0]);

  // The rest are header fields, except the last empty line.
  const headers: Buffer[] = [];
  for (let i = 1; i < lines.length - 1; i++) {
    // Copy the line so it's not a view into the big buffer.
    const h = Buffer.from(lines[i]);
    if (!validateHeader(h)) {
      throw new HTTPError(400, "bad header field");
    }
    headers.push(h);
  }

  // The last line should be empty (the \r\n\r\n).
  if (lines[lines.length - 1].length !== 0) {
    throw new HTTPError(400, "empty line expected");
  }

  return { method, uri, version, headers };
}

// Splits a buffer by \r\n into an array of lines.
function splitLines(data: Buffer): Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;

  for (let i = 0; i < data.length; i++) {
    // Look for \r\n (13 = \r, 10 = \n)
    if (data[i] === 13 && data[i + 1] === 10) {
      // Push everything from start to this point.
      lines.push(data.subarray(start, i));
      start = i + 2; // Skip past the \r\n
      i++; // Skip the \n in the loop
    }
  }

  // Push the last piece if there's anything left.
  if (start < data.length) {
    lines.push(data.subarray(start));
  }

  return lines;
}

// Parses "GET /path HTTP/1.1" into method, uri, and version.
function parseRequestLine(line: Buffer): [string, Buffer, string] {
  // Convert to string for easy splitting.
  const parts = line.toString("latin1").split(" ");

  if (parts.length !== 3) {
    throw new HTTPError(400, "bad request line");
  }

  // parts[2] is like "HTTP/1.1", we only want "1.1".
  const version = parts[2].replace("HTTP/", "");

  return [parts[0], Buffer.from(parts[1]), version];
}

// Basic validation: must have a colon and not start with a space.
function validateHeader(header: Buffer): boolean {
  if (header.length === 0) return false;
  const idx = header.indexOf(":");
  if (idx <= 0) return false; // No colon, or colon at the very start.
  return true;
}
