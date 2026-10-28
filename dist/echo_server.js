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
// we are creating a new state whenever a client joins our server
function soInit(socket) {
    const conn = {
        socket: socket,
        err: null,
        ended: false,
        reader: null,
    };
    // Data arrived. Pause the stream so we don't lose bytes
    // before the next soRead() call.
    socket.on("data", (data) => {
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
    socket.on("error", (err) => {
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
function soRead(conn) {
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
function soWrite(conn, data) {
    return new Promise((resolve, reject) => {
        if (conn.err) {
            reject(conn.err);
            return;
        }
        // Node's write takes a callback when the OS accepts the bytes.
        conn.socket.write(data, (err) => {
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
}
// The main loop for a single client.
async function serveClient(socket) {
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
