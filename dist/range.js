"use strict";
// parses , bytes 0 - 999 into [0, 999]
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRangeHeader = parseRangeHeader;
function parseRangeHeader(value) {
    // remove the "bytes=" prefix
    const prefix = "bytes=";
    if (!value.startsWith(prefix)) {
        return null; // not byts in range
    }
    const spec = value.slice(prefix.length);
    //split on "-"
    const parts = spec.split("-");
    if (parts.length !== 2) {
        return null; // invalid format .
    }
    const [left, right] = parts;
    // case 1 : "bytes=500 - " from 500 to the end.
    if (left !== "" && right === "") {
        const start = parseInt(left, 10);
        if (isNaN(start))
            return null;
        return [start, null];
    }
    // Case 2: "bytes=-500" (last 500 bytes).
    // We cannot resolve this without the file size, so return a special marker.
    // For now, we return null (we will handle this later).
    if (left === "" && right !== "") {
        return null; // Suffix range, needs file size.
    }
    // Case 3: "bytes=0-999" (start to end).
    if (left !== "" && right !== "") {
        const start = parseInt(left, 10);
        const end = parseInt(right, 10);
        if (isNaN(start) || isNaN(end))
            return null;
        return [start, end];
    }
    return null;
}
