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
exports.fieldGet = fieldGet;
exports.readerFromReq = readerFromReq;
exports.readerFromMemory = readerFromMemory;
exports.readerFromGenerator = readerFromGenerator;
exports.readChunks = readChunks;
exports.body2stream = body2stream;
exports.gzipFilter = gzipFilter;
exports.enableCompression = enableCompression;
const net_io_1 = require("./net_io");
const dynbuf_1 = require("./dynbuf");
const http_parser_1 = require("./http_parser");
const stream = __importStar(require("stream"));
const zlib = __importStar(require("zlib"));
const promises_1 = require("stream/promises");
// Find a header value by name (case-insensitive).
function fieldGet(headers, key) {
    // We convert the key to lowercase for comparison.
    const lowerKey = key.toLowerCase();
    for (const h of headers) {
        // Find the colon that separates name from value.
        const idx = h.indexOf(":");
        if (idx < 0)
            continue;
        // Extract the name and trim whitespace.
        const name = h.subarray(0, idx).toString("latin1").trim();
        if (name.toLowerCase() === lowerKey) {
            // Extract the value and trim whitespace.
            const val = h
                .subarray(idx + 1)
                .toString("latin1")
                .trim();
            return Buffer.from(val);
        }
    }
    return null; // Not found
}
// Creates a BodyReader based on the request headers.
function readerFromReq(conn, buf, req) {
    let bodyLen = -1;
    // 1. Check for Content-Length.
    const contentLen = fieldGet(req.headers, "Content-Length");
    if (contentLen) {
        bodyLen = parseInt(contentLen.toString("latin1"), 10);
        if (isNaN(bodyLen)) {
            throw new http_parser_1.HTTPError(400, "bad Content-Length");
        }
    }
    // 2. GET and HEAD are not allowed to have a body.
    const bodyAllowed = !(req.method === "GET" || req.method === "HEAD");
    if (!bodyAllowed && bodyLen > 0) {
        throw new http_parser_1.HTTPError(400, "HTTP body not allowed");
    }
    if (!bodyAllowed) {
        bodyLen = 0;
    }
    if (bodyLen < 0) {
        // Check if the client is sending chunked data.
        const te = fieldGet(req.headers, "Transfer-Encoding");
        if (te && te.toString("latin1").toLowerCase() === "chunked") {
            return readerFromGenerator(readChunks(conn, buf));
        }
    }
    if (bodyLen < 0)
        throw new http_parser_1.HTTPError(411, "Content-Length required");
    // 4. Return the BodyReader.
    return readerFromConnLength(conn, buf, bodyLen);
}
// A BodyReader that reads exactly `remain` bytes from the socket/buffer.
function readerFromConnLength(conn, buf, remain) {
    return {
        length: remain,
        read: async () => {
            // If we are done, return an empty buffer (EOF).
            if (remain === 0) {
                return Buffer.from("");
            }
            // If the buffer is empty, read more from the socket.
            if (buf.length === 0) {
                const data = await (0, net_io_1.soRead)(conn);
                (0, dynbuf_1.bufPush)(buf, data);
                if (data.length === 0) {
                    throw new Error("Unexpected EOF from HTTP body");
                }
            }
            // Consume from the buffer, but no more than `remain`.
            const consume = Math.min(buf.length, remain);
            remain -= consume;
            // Copy the consumed bytes into a new buffer.
            const data = Buffer.from(buf.data.subarray(0, consume));
            (0, dynbuf_1.bufPop)(buf, consume);
            return data;
        },
    };
}
// A BodyReader that reads from an in-memory buffer.
function readerFromMemory(data) {
    let done = false;
    return {
        length: data.length,
        read: async () => {
            if (done) {
                return Buffer.from(""); // EOF
            }
            done = true;
            return data; // Send the whole buffer once
        },
    };
}
// Turns a generator into a BodyReader.
function readerFromGenerator(gen) {
    return {
        // -1 tells our server to use chunked encoding.
        length: -1,
        read: async () => {
            // Ask the generator for the next chunk.
            const r = await gen.next();
            // If the generator is exhausted, signal EOF with an empty buffer.
            if (r.done) {
                return Buffer.from("");
            }
            // Otherwise, hand back the chunk the generator produced.
            return r.value;
        },
    };
}
// Reads chunked data from the socket and yields each chunk.
async function* readChunks(conn, buf) {
    while (true) {
        // Find the \r\n that ends the chunk size line.
        const idx = buf.data.subarray(0, buf.length).indexOf("\r\n");
        // If not found, read more data from the socket.
        if (idx < 0) {
            const data = await (0, net_io_1.soRead)(conn);
            (0, dynbuf_1.bufPush)(buf, data);
            // If the client disconnected, that's an error.
            if (data.length === 0) {
                throw new Error("Unexpected EOF in chunk size");
            }
            // Try again.
            continue;
        }
        // We have the full size line. Extract the hex string.
        const hexStr = buf.data.subarray(0, idx).toString("latin1");
        // Convert hex to a number. (e.g., "5" -> 5, "a" -> 10)
        const size = parseInt(hexStr, 16);
        if (isNaN(size)) {
            throw new http_parser_1.HTTPError(400, "bad chunk size");
        }
        // Remove the size line (including the \r\n) from the buffer.
        (0, dynbuf_1.bufPop)(buf, idx + 2);
        // If size is 0, the body is finished.
        if (size === 0) {
            // The last chunk is followed by a final \r\n.
            if (buf.length < 2) {
                const data = await (0, net_io_1.soRead)(conn);
                (0, dynbuf_1.bufPush)(buf, data);
            }
            (0, dynbuf_1.bufPop)(buf, 2);
            return; // Stop the generator.
        }
        // Now read exactly `size` bytes of data.
        let remain = size;
        while (remain > 0) {
            // If the buffer is empty, read more from the socket.
            if (buf.length === 0) {
                const data = await (0, net_io_1.soRead)(conn);
                (0, dynbuf_1.bufPush)(buf, data);
                if (data.length === 0) {
                    throw new Error("Unexpected EOF in chunk data");
                }
            }
            // Take as much as we can, up to `remain`.
            const consume = Math.min(buf.length, remain);
            const chunk = Buffer.from(buf.data.subarray(0, consume));
            (0, dynbuf_1.bufPop)(buf, consume);
            remain -= consume;
            // Yield the chunk so the caller can use it.
            yield chunk;
        }
        // After the data, there is a trailing \r\n. Remove it.
        if (buf.length < 2) {
            const data = await (0, net_io_1.soRead)(conn);
            (0, dynbuf_1.bufPush)(buf, data);
        }
        (0, dynbuf_1.bufPop)(buf, 2);
    }
}
// convert out custom bodyreader into a node.js Redable stream.
function body2stream(reader) {
    return new stream.Readable({
        // This callback is called when the consumer wants more data.
        read: async function () {
            try {
                // Read a chunk from our custom reader.
                const data = await reader.read();
                // If empty, signal EOF by pushing null.
                if (data.length === 0) {
                    this.push(null);
                }
                else {
                    // Push the data to the stream.
                    this.push(data);
                }
            }
            catch (err) {
                // If our reader throws, destroy the stream with the error.
                this.destroy(err instanceof Error ? err : new Error("read error"));
            }
        },
    });
}
// Wraps a BodyReader with gzip compression.
function gzipFilter(reader) {
    // 1. Create the gzip compressor (a Transform stream).
    const gz = zlib.createGzip();
    // 2. Convert our BodyReader into a Readable stream.
    const input = body2stream(reader);
    // 3. Pipe the input into the gzip compressor.
    // We don't await this; it runs in the background.
    (0, promises_1.pipeline)(input, gz).catch((err) => {
        gz.destroy(err);
    });
    // Get an async iterator for the gzip output.
    const iter = gz.iterator();
    // 4. Return a new BodyReader that reads from the gzip output.
    return {
        length: -1, // We don't know the compressed size, so use chunked.
        read: async () => {
            // Read compressed data from the gzip stream.
            // read the next compressed chunk
            const r = await iter.next();
            // if stream is done return EOF.
            if (r.done) {
                return Buffer.from("");
            }
            // otherwise return the chunk
            return r.value;
        },
        close: reader.close,
    };
}
// Checks if the request accepts gzip and wraps the body.
function enableCompression(req, res) {
    // 1. Check if the client supports gzip.
    const acceptEncoding = fieldGet(req.headers, "Accept-Encoding");
    if (!acceptEncoding || !acceptEncoding.toString("latin1").includes("gzip")) {
        return res; // Client doesn't support gzip, return as-is.
    }
    // 2. Do not compress range requests (they need raw bytes).
    if (fieldGet(req.headers, "Range")) {
        return res; // Range requests, skip compression.
    }
    // 3. Wrap the body with gzip.
    const compressed = gzipFilter(res.body);
    // 4. Add the Content-Encoding header.
    return {
        code: res.code,
        headers: [...res.headers, Buffer.from("Content-Encoding: gzip")],
        body: compressed,
    };
}
