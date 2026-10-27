// Import Node's built-in networking module.
import * as net from "net";

// This is the callback.
// The runtime will call it when a client connects.
function newConn(socket: net.Socket): void {
  // // Print the client's IP address and port.
  console.log("New connection:", socket.remoteAddress, socket.remotePort);

  // Handle connection errors so the server dosen't crash
  socket.on("error", (err: Error) => {
    console.log("Socket error :", err.message);
  });

  // Runs every time the client sends bytes.
  socket.on("data", (data: Buffer) => {
    // Print what we received.
    console.error("Client sent:", data.toString());
    // Echo the same bytes back to the client.
    socket.write(data);

    // If the data includes 'q', close the connection/
    if (data.includes("q")) {
      console.log("closing connection.....");
      socket.end();
    }
  });
}

// 1. Create the Listening Socket.
let server = net.createServer();

// Handle the server error also
server.on("error", (err: Error) => {
  console.error("server error", err.message);
});

// 2. Register the callback for the 'connection' event.
// This gives the function to the Event Loop.
server.on("connection", newConn);

// 3. Bind and Listen on port 1234.
server.listen({ host: "127.0.0.1", port: 1234 });

console.log("Server listening on 127.0.0.1:1234...");
