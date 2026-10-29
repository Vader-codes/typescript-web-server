"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const net = __importStar(require("net"));
const net_io_1 = require("./net_io");
const dynbuf_1 = require("./dynbuf");
// The main loop for a single client.
async function serveClient(socket) {
    const conn = (0, net_io_1.soInit)(socket);
    // Create an empty dynamic buffer for this client.
    const buf = { data: Buffer.alloc(0), length: 0 };
    while (true) {
        // 1. Try to extract a complete message from the buffer.
        const msg = (0, dynbuf_1.cutMessage)(buf);
        if (!msg) {
            // 2. No complete message yet. Read more data from the socket.
            const data = await (0, net_io_1.soRead)(conn);
            // If EOF, stop.
            if (data.length === 0) {
                console.log("Client disconnected (EOF)");
                break;
            }
            // Append the new data to the buffer and try again.
            (0, dynbuf_1.bufPush)(buf, data);
            continue; // Go back to the top of the loop
        }
        // 3. We have a complete message!
        // Check if the client wants to quit (msg contains 'quit').
        if (msg.equals(Buffer.from("quit\n"))) {
            await (0, net_io_1.soWrite)(conn, Buffer.from("Bye.\n"));
            socket.destroy();
            return;
        }
        // Otherwise, echo it back with a prefix.
        const reply = Buffer.concat([Buffer.from("Echo: "), msg]);
        await (0, net_io_1.soWrite)(conn, reply);
    }
    socket.destroy();
}
function newConn(socket) {
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
