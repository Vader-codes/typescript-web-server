import * as net from "net";
import { TCPConn, soInit, soRead, soWrite } from "./net_io";
import { DynBuf, bufPush } from "./dynbuf";
import { cutMessage, HTTPError } from "./http_parser";
import { HTTPReq, HTTPRes, BodyReader } from "./http_types";
import {
  readerFromGenerator,
  readerFromMemory,
  readerFromReq,
} from "./http_io";
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
    const res: HTTPRes = await handleReq(msg, reqBody);
    await writeHTTPResp(conn, res);

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

async function writeHTTPResp(conn: TCPConn, res: HTTPRes): Promise<void> {
  // 1. Build the first line (e.g., "HTTP/1.1 200 OK").
  // We only handle 200 and 404 for now.
  const status = res.code === 200 ? "OK" : "Not Found";
  let headerText = `HTTP/1.1 ${res.code} ${status}\r\n`;

  // If the length is -1, we do not know the size, so use chunked encoding.
  if (res.body.length < 0) {
    headerText += `Transfer-Encoding : chunked\r\n`;
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

  //  Send the body bytes.
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
