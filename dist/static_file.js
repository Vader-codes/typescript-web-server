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
exports.readerFromFile = readerFromFile;
const fs = __importStar(require("fs/promises"));
// Opens a file and returns a BodyReader that streams it.
async function readerFromFile(path) {
    // Open the file (throws if it doesn't exist or can't be read).
    const fp = await fs.open(path, "r");
    // Get the file metadata.
    const stat = await fp.stat();
    if (!stat.isFile()) {
        await fp.close();
        throw new Error("not a regular file");
    }
    const size = stat.size;
    let offset = 0;
    return {
        length: size,
        read: async () => {
            // If we've read the whole file, return EOF.
            if (offset >= size) {
                return Buffer.from("");
            }
            // Read a chunk from the file.
            const chunkSize = Math.min(65536, size - offset); // 64KB chunks
            const buf = Buffer.alloc(chunkSize);
            const result = await fp.read(buf, 0, chunkSize, offset);
            offset += result.bytesRead;
            // Return the actual bytes read.
            return buf.subarray(0, result.bytesRead);
        },
        close: async () => {
            // Close the file handle when we're done.
            await fp.close();
        },
    };
}
