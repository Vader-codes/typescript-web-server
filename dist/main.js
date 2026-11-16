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
const http_parser_1 = require("./http_parser");
const http_io_1 = require("./http_io");
// The main loop for a single client.
async function serveClient(socket) {
    const conn = (0, net_io_1.soInit)(socket);
    const buf = { data: Buffer.alloc(0), length: 0 };
    while (true) {
        // 1. Try to extract a complete HTTP header
        const msg = (0, http_parser_1.cutMessage)(buf);
        if (!msg) {
            // No complete header yet, read more data.
            const data = await (0, net_io_1.soRead)(conn);
            if (data.length === 0) {
                console.log("Client disconnected (EOF)");
                return;
            }
            (0, dynbuf_1.bufPush)(buf, data);
            continue;
        }
        // 2. We have a full header!
        // (These functions don't exist yet, we will build them next)
        const reqBody = (0, http_io_1.readerFromReq)(conn, buf, msg);
        const res = await handleReq(msg, reqBody);
        await writeHTTPResp(conn, res);
        // Ensure the request body is completely read.
        // If the handler ignored it, we must drain it here.
        while (true) {
            const chunk = await reqBody.read();
            if (chunk.length === 0)
                break;
        }
    }
}
// A generator that yields a string every second.
async function* countSheep() {
    for (let i = 0; i < 10; i++) {
        // Wait 1 second before yielding the next value
        await new Promise((resolve) => setTimeout(resolve, 1000));
        yield Buffer.from(`Sheep ${i}\n`);
    }
}
async function handleReq(req, body) {
    // Check the URI (convert bytes to string for easy comparison).
    const uri = req.uri.toString("latin1");
    if (uri == "/sheep") {
        return {
            code: 200,
            headers: [Buffer.from("content-type : text/plain")],
            body: (0, http_io_1.readerFromGenerator)(countSheep()),
        };
    }
    if (uri === "/echo") {
        // Echo the request body back.
        let bodyData = Buffer.from("");
        while (true) {
            const chunk = await body.read();
            if (chunk.length === 0)
                break;
            bodyData = Buffer.concat([bodyData, chunk]);
        }
        return {
            code: 200,
            headers: [Buffer.from("Content-Type: text/plain")],
            body: (0, http_io_1.readerFromMemory)(bodyData),
        };
    }
    else {
        // Default response.
        const msg = Buffer.from("hello world\n");
        return {
            code: 200,
            headers: [Buffer.from("Content-Type: text/plain")],
            body: (0, http_io_1.readerFromMemory)(msg),
        };
    }
}
async function writeHTTPResp(conn, res) {
    // 1. Build the first line (e.g., "HTTP/1.1 200 OK").
    // We only handle 200 and 404 for now.
    const status = res.code === 200 ? "OK" : "Not Found";
    let headerText = `HTTP/1.1 ${res.code} ${status}\r\n`;
    // If the length is -1, we do not know the size, so use chunked encoding.
    if (res.body.length < 0) {
        headerText += `Transfer-Encoding : chunked\r\n`;
    }
    else {
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
    await (0, net_io_1.soWrite)(conn, Buffer.from(headerText));
    //  Send the body bytes.
    while (true) {
        const data = await res.body.read();
        if (data.length === 0) {
            // EOF. If we were chucking , send the terminator
            if (res.body.length < 0) {
                await (0, net_io_1.soWrite)(conn, Buffer.from("0\r\n\r\n"));
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
            await (0, net_io_1.soWrite)(conn, chunk);
        }
        else {
            // normal mode : just send the raw data
            await (0, net_io_1.soWrite)(conn, data);
        }
    }
}
function newConn(socket) {
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
