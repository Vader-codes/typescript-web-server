"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bufPush = bufPush;
exports.bufPop = bufPop;
exports.cutMessage = cutMessage;
// Append new data to the buffer, growing it if necessary.
function bufPush(buf, data) {
    // calculate the total length after appending.
    const newLen = buf.length + data.length;
    // If the existing memory block is too small, need to grow..
    if (buf.data.length < newLen) {
        // start with atleast 32bytes, then double it until it fits.
        let cap = Math.max(buf.data.length, 32);
        while (cap < newLen) {
            cap *= 2;
        }
        // allocate the new, larger block.
        const grown = Buffer.alloc(cap);
        // copy the old data into new block.
        buf.data.copy(grown, 0, 0);
        // Replace the old block with new one
        buf.data = grown;
    }
    // copy the new incoming data right after the existing data
    data.copy(buf.data, buf.length, 0);
    // update the length to include new data
    buf.length = newLen;
}
// Removes the first `len` bytes from the buffer.
function bufPop(buf, len) {
    // Shift all remaining data to the left (O(N) operation).
    buf.data.copyWithin(0, len, buf.length);
    // Update the length.
    buf.length -= len;
}
// Tries to extract one complete message (ending in '\n') from the buffer.
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
