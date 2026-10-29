"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.soInit = soInit;
exports.soRead = soRead;
exports.soWrite = soWrite;
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
