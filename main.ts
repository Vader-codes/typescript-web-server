import * as net from "net";
import * as fs from "fs/promises";
import { TCPConn, soInit, soRead, soWrite } from "./net_io";
import { DynBuf, bufPush } from "./dynbuf";
import { cutMessage, HTTPError } from "./http_parser";
import { HTTPReq, HTTPRes, BodyReader } from "./http_types";
import {
  readerFromGenerator,
  readerFromMemory,
  readerFromReq,
  fieldGet,
  enableCompression,
} from "./http_io";
import { readerFromFile } from "./static_file";
import { parseRangeHeader } from "./range";
import { BufferGenerator } from "./http_types";

// The main loop for a single client.
async function serveClient(socket: net.Socket): Promise<void> {
  const conn = soInit(socket);
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };

  while (true) {
    // 1. Try to extract a complete HTTP header
    const msg: null | HTTPReq = cutMessage(buf);

    if (!msg) {
      // No complete header yet, read more data.
      const data = await soRead(conn);
      if (data.length === 0) {
        console.log("Client disconnected (EOF)");
        return;
      }
      bufPush(buf, data);
      continue;
    }

    // 2. We have a full header!
    // (These functions don't exist yet, we will build them next)
    const reqBody: BodyReader = readerFromReq(conn, buf, msg);
    const res: HTTPRes = enableCompression(msg, await handleReq(msg, reqBody));
    await writeHTTPResp(conn, res, msg.method === "HEAD");

    // Ensure the request body is completely read.
    // If the handler ignored it, we must drain it here.
    while (true) {
      const chunk = await reqBody.read();
      if (chunk.length === 0) break;
    }
  }
}

// A generator that yields a string every second.
async function* countSheep(): BufferGenerator {
  for (let i = 0; i < 10; i++) {
    // Wait 1 second before yielding the next value
    await new Promise((resolve) => setTimeout(resolve, 1000));
    yield Buffer.from(`Sheep ${i}\n`);
  }
}

async function handleReq(req: HTTPReq, body: BodyReader): Promise<HTTPRes> {
  // Check the URI (convert bytes to string for easy comparison).
  const uri = req.uri.toString("latin1");

  // Inside handleReq, replace the existing /files/ block with this:

  if (uri.startsWith("/files/")) {
    const filePath = uri.slice("/files/".length);
    try {
      // 1. Get the file size first (we need it for range calculations).
      const stat = await fs.stat(filePath);
      const size = stat.size;

      // build cache headers.
      const lastModified = stat.mtime.toUTCString();
      const etag = `"${size}-${stat.mtime.getTime()}"`; // simple fingerprint

      // 2. Check if the client already has a valid cache.
      const ifModifiedSince = fieldGet(req.headers, "If-Modified-Since");
      const ifNoneMatch = fieldGet(req.headers, "If-None-Match");

      const cacheValid =
        (ifModifiedSince &&
          ifModifiedSince.toString("latin1") === lastModified) ||
        (ifNoneMatch && ifNoneMatch.toString("latin1") === etag);

      // 3. If the cache is valid, return 304 Not Modified.
      if (cacheValid) {
        return {
          code: 304,
          headers: [
            Buffer.from(`Last-Modified: ${lastModified}`),
            Buffer.from(`ETag: ${etag}`),
          ],
          body: readerFromMemory(Buffer.from("")),
        };
      }

      // 4. Add the validators to the response headers.
      const headers: Buffer[] = [
        Buffer.from("Content-Type: application/octet-stream"),
        Buffer.from("Accept-Ranges: bytes"),
        Buffer.from(`Last-Modified: ${lastModified}`),
        Buffer.from(`ETag: ${etag}`),
      ];

      // 2. Check for the Range header.
      const rangeHeader = fieldGet(req.headers, "Range");
      let start = 0;
      let end = size - 1; // Inclusive end.
      let isPartial = false;

      if (rangeHeader) {
        const parsed = parseRangeHeader(rangeHeader.toString("latin1"));
        if (parsed) {
          start = parsed[0];
          end = parsed[1] !== null ? parsed[1] : size - 1;
          // Clamp to file size.
          if (start >= size) {
            // Start is beyond the file. Return 416.
            return {
              code: 416,
              headers: [Buffer.from(`Content-Range: bytes */${size}`)],
              body: readerFromMemory(Buffer.from("")),
            };
          }
          end = Math.min(end, size - 1);
          isPartial = true;
        }
      }

      // 3. Create the BodyReader for the slice.
      const body = await readerFromFile(filePath, start, end + 1);

      if (isPartial) {
        headers.push(
          Buffer.from(`Content-Range: bytes ${start}-${end}/${size}`),
        );
        return { code: 206, headers, body };
      } else {
        return { code: 200, headers, body };
      }
    } catch (err) {
      return {
        code: 404,
        headers: [Buffer.from("Content-Type: text/plain")],
        body: readerFromMemory(Buffer.from("Not Found\n")),
      };
    }
  }

  if (uri == "/sheep") {
    return {
      code: 200,
      headers: [Buffer.from("content-type : text/plain")],
      body: readerFromGenerator(countSheep()),
    };
  }
  if (uri === "/echo") {
    // Echo the request body back.
    let bodyData = Buffer.from("");
    while (true) {
      const chunk = await body.read();
      if (chunk.length === 0) break;
      bodyData = Buffer.concat([bodyData, chunk]);
    }
    return {
      code: 200,
      headers: [Buffer.from("Content-Type: text/plain")],
      body: readerFromMemory(bodyData),
    };
  } else {
    // Default response.
    const msg = Buffer.from("hello world\n");
    return {
      code: 200,
      headers: [Buffer.from("Content-Type: text/plain")],
      body: readerFromMemory(msg),
    };
  }
}

async function writeHTTPResp(
  conn: TCPConn,
  res: HTTPRes,
  isHead: boolean,
): Promise<void> {
  // 1. Build the first line (e.g., "HTTP/1.1 200 OK").
  const statusText: Record<number, string> = {
    200: "OK",
    206: "Partial Content",
    404: "Not Found",
    416: "Range Not Satisfiable",
    304: "Not Modified",
  };

  const status = statusText[res.code] || "Unknown";

  let headerText = `HTTP/1.1 ${res.code} ${status}\r\n`;

  // If the length is -1, we do not know the size, so use chunked encoding.
  if (res.body.length < 0) {
    headerText += `Transfer-Encoding: chunked\r\n`;
  } else {
    //  Add Content-Length (from the BodyReader).
    headerText += `Content-Length: ${res.body.length}\r\n`;
  }

  //  Add the custom headers.
  for (const h of res.headers) {
    headerText += `${h.toString("latin1")}\r\n`;
  }

  //  Add the empty line to end the header.
  headerText += "\r\n";

  //  Send the header bytes.
  await soWrite(conn, Buffer.from(headerText));

  // if Head , skip the body entirely
  if (isHead) {
    await res.body.close?.(); // still close the file handle
    return;
  }

  //  Send the body bytes.and alsways close it when we're done.
  try {
    while (true) {
      const data = await res.body.read();

      if (data.length === 0) {
        // EOF. If we were chucking , send the terminator
        if (res.body.length < 0) {
          await soWrite(conn, Buffer.from("0\r\n\r\n"));
        }
        break;
      }

      if (res.body.length < 0) {
        // chunked code : format  is [hex size]\r\n[data]\r\n
        const hexsize = data.length.toString(16);
        const chunk = Buffer.concat([
          Buffer.from(hexsize + "\r\n"),
          data,
          Buffer.from("\r\n"),
        ]);
        await soWrite(conn, chunk);
      } else {
        // normal mode : just send the raw data
        await soWrite(conn, data);
      }
    }
  } finally {
    // always close the body
    await res.body.close?.();
  }
}

function newConn(socket: net.Socket): void {
  console.log("New connection:", socket.remoteAddress, socket.remotePort);
  serveClient(socket).catch((err) => {
    console.error("Client error:", err.message);
    socket.destroy();
  });
}

// pauseOnConnect is critical. It stops the OS from firing 'data'
// before we're actually ready to read.
let server = net.createServer({ pauseOnConnect: true });

// Register the connection handler.
server.on("connection", newConn);
server.listen({ host: "127.0.0.1", port: 1234 });

console.log("Server listening on 127.0.0.1:1234...");
