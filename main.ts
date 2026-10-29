import * as net from "net";
import { TCPConn, soInit, soRead, soWrite } from "./net_io";
import { DynBuf, bufPush, cutMessage } from "./dynbuf";

// The main loop for a single client.
async function serveClient(socket: net.Socket): Promise<void> {
  const conn = soInit(socket);

  // Create an empty dynamic buffer for this client.
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };

  while (true) {
    // 1. Try to extract a complete message from the buffer.
    const msg = cutMessage(buf);

    if (!msg) {
      // 2. No complete message yet. Read more data from the socket.
      const data = await soRead(conn);

      // If EOF, stop.
      if (data.length === 0) {
        console.log("Client disconnected (EOF)");
        break;
      }

      // Append the new data to the buffer and try again.
      bufPush(buf, data);
      continue; // Go back to the top of the loop
    }

    // 3. We have a complete message!
    // Check if the client wants to quit (msg contains 'quit').
    if (msg.equals(Buffer.from("quit\n"))) {
      await soWrite(conn, Buffer.from("Bye.\n"));
      socket.destroy();
      return;
    }

    // Otherwise, echo it back with a prefix.
    const reply = Buffer.concat([Buffer.from("Echo: "), msg]);
    await soWrite(conn, reply);
  }

  socket.destroy();
}

function newConn(socket: net.Socket): void {
  console.log("New connection:", socket.remoteAddress, socket.remotePort);

  // Don't await this! If we did, the server would block and only
  // handle one client at a time.
  serveClient(socket).catch((err) => {
    console.error("Client error:", err.message);
    socket.destroy();
  });
}

// pauseOnConnect is critical. It stops the OS from firing 'data'
// before we're actually ready to read.
let server = net.createServer({ pauseOnConnect: true });

server.on("connection", newConn);
server.listen({ host: "127.0.0.1", port: 1234 });

console.log("Server listening on 127.0.0.1:1234...");
