import * as net from "net";

// We wrap the raw socket so we can track state (errors, EOF)
// that Node doesn't keep for us.
type TCPConn = {
  socket: net.Socket;
  err: null | Error; // Sticky error. If set, the connection is dead.
  ended: boolean; // Set when we get EOF from the client.
  reader: null | {
    // Holds the resolve/reject for the current read.
    resolve: (value: Buffer) => void;
    reject: (reason: Error) => void;
  };
};

// we are creating a new state whenever a client joins our server
function soInit(socket: net.Socket): TCPConn {
  const conn: TCPConn = {
    socket: socket,
    err: null,
    ended: false,
    reader: null,
  };

  // Data arrived. Pause the stream so we don't lose bytes
  // before the next soRead() call.
  socket.on("data", (data: Buffer) => {
    socket.pause();
    // If someone is waiting for data, hand it over.
    if (conn.reader) {
      conn.reader.resolve(data);
      conn.reader = null;
    }
  });

  // Client hung up.
  socket.on("end", () => {
    conn.ended = true;
    // Wake up any pending read with an empty buffer (EOF).
    if (conn.reader) {
      conn.reader.resolve(Buffer.from(""));
      conn.reader = null;
    }
  });

  // Network error or broken pipe.
  socket.on("error", (err: Error) => {
    conn.err = err;
    // If a read is blocked, fail it immediately.
    if (conn.reader) {
      conn.reader.reject(err);
      conn.reader = null;
    }
  });

  return conn;
}

// The custom promise-based read function we're building.
function soRead(conn: TCPConn): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Fail fast if the connection is already broken.
    if (conn.err) {
      reject(conn.err);
      return;
    }
    // Fail fast with EOF if the client already left.
    if (conn.ended) {
      resolve(Buffer.from(""));
      return;
    }

    // Save the callbacks so the 'data' event can trigger them.
    conn.reader = { resolve: resolve, reject: reject };
    // Start the stream flowing again.
    conn.socket.resume();
  });
}

// Promise wrapper for socket.write.
function soWrite(conn: TCPConn, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (conn.err) {
      reject(conn.err);
      return;
    }
    // Node's write takes a callback when the OS accepts the bytes.
    conn.socket.write(data, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// The main loop for a single client.
async function serveClient(socket: net.Socket): Promise<void> {
  const conn = soInit(socket); // sets some client's state value

  // Looks synchronous, but yields to the event loop on every await.
  while (true) {
    const data = await soRead(conn);

    // Empty buffer means EOF.
    if (data.length === 0) {
      console.log("Client disconnected (EOF)");
      break;
    }

    console.log("Client sent:", data.toString());
    await soWrite(conn, data);
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
