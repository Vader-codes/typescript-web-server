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
async function readerFromFile(path, start = 0, end = -1) {
    const fp = await fs.open(path, "r");
    const stat = await fp.stat();
    if (!stat.isFile()) {
        await fp.close();
        throw new Error("not a regular file");
    }
    const size = stat.size;
    // If end is -1, read to the end of the file.
    if (end < 0) {
        end = size;
    }
    // Clamp the end to the file size.
    end = Math.min(end, size);
    // Clamp the start.
    start = Math.max(0, start);
    // The total length of the slice.
    const totalLength = end - start;
    let offset = start;
    return {
        length: totalLength,
        read: async () => {
            // If we've read the whole slice, return EOF.
            if (offset >= end) {
                return Buffer.from("");
            }
            // Read a chunk, but no more than what's left in the slice.
            const chunkSize = Math.min(65536, end - offset);
            const buf = Buffer.alloc(chunkSize);
            const result = await fp.read(buf, 0, chunkSize, offset);
            offset += result.bytesRead;
            return buf.subarray(0, result.bytesRead);
        },
        close: async () => {
            await fp.close();
        },
    };
}
