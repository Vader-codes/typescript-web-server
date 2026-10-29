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
// Append new data to the buffer, growing it if necessary.
function bufPush(buf, data) {
    // calculate the total length after appending.
    const newLen = buf.length + data.length;
    // If teh existing memory block is too small , need to grow..
    if (buf.data.length < newLen) {
        // start with atleast 32bytes, then double it until it fits.
        let cap = Math.max(buf.data.length, 32);
        while (cap < newLen) {
            cap *= 2;
        }
        // allocate the new, larget block.
        const grown = Buffer.alloc(cap);
        // copy the old data into new block.
        buf.data.copy(grown, 0, 0);
        // Replace the old block with new one
        buf.data = grown;
    }
    // copy the new incoming data right after the existing data
    data.copy(buf.data, buf.length, 0); //(target, targetStart, sourceStart, sourceEnd)
    // update the length to inlcude new data
    buf.length = newLen;
}
// Removes the first `len` bytes from the buffer.
function bufPop(buf, len) {
    // Shift all remaining data to the left (O(N) operation).
    buf.data.copyWithin(0, len, buf.length); //(target, targetStart, sourceStart, sourceEnd)
    // Update the length.
    buf.length -= len;
}
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
// // Tries to extract one complete message (ending in '\n') from the buffer.
// Returns null if the buffer doesn't contain a full message yet.
function cutMessage(buf) {
    // Search for the newline character in the valid part of the buffer.
    const idx = buf.data.subarray(0, buf.length).indexOf("\n");
    // If no newline is found, the message is incomplete.
    if (idx < 0) {
        return null;
    }
    // Copy the message (including the newline) into a new buffer.
    const msg = Buffer.from(buf.data.subarray(0, idx + 1));
    // Remove the message from the front of the dynamic buffer.
    bufPop(buf, idx + 1);
    // Return the extracted message.
    return msg;
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
    const conn = soInit(socket);
    // Create an empty dynamic buffer for this client.
    const buf = { data: Buffer.alloc(0), length: 0 };
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
