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
const http = __importStar(require("http"));
// A helper function to make a request and print the response.
function makeRequest(method, path, body = "") {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: "127.0.0.1",
            port: 1234,
            path: path,
            method: method,
            headers: {
                "Content-Type": "text/plain",
                "Content-Length": Buffer.byteLength(body),
            },
        };
        const req = http.request(options, (res) => {
            console.log(`\n--- Response for ${method} ${path} ---`);
            console.log(`Status: ${res.statusCode}`);
            // Print headers
            for (const [key, value] of Object.entries(res.headers)) {
                console.log(`${key}: ${value}`);
            }
            console.log("--- Body ---");
            // Print body as it arrives
            res.on("data", (chunk) => {
                process.stdout.write(chunk);
            });
            res.on("end", () => {
                console.log("\n--- End ---");
                resolve();
            });
        });
        req.on("error", reject);
        if (body) {
            req.write(body);
        }
        req.end();
    });
}
// Main function to run tests
async function main() {
    // Test 1: GET request
    await makeRequest("GET", "/");
    // Test 2: POST request to /echo
    await makeRequest("POST", "/echo", "hello from client");
    // Test 3: Streaming request to /sheep
    // Note: This will take 10 seconds because the server sends a sheep every second.
    await makeRequest("GET", "/sheep");
}
main().catch(console.error);
