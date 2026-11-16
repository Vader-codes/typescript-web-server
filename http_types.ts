// A parsed HTTP request header
export type HTTPReq = {
  method: string; // e.g., "GET" or "POST"
  uri: Buffer; // The raw URI bytes (e.g., "/index.html")
  version: string; // e.g., "1.1"
  headers: Buffer[]; // An array of raw header lines
};

// A parsed HTTP responses
export type HTTPRes = {
  code: number; // e.g., 200 or 404
  headers: Buffer[]; // An array of raw header lines
  body: BodyReader; // The response body
};

// An interface for reading data from the body on the fly.
// This prevents us from loading massive files into memory.
export type BodyReader = {
  // The total length of the body (Content-Length).
  // -1 means the length is unknown (e.g., chunked encoding).
  length: number;

  // Read the next chunk of data.
  // Returns an empty buffer when the body is completely read.
  read: () => Promise<Buffer>;
  // optional cleanup function, called when we're done with the body
  close?: () => Promise<void>;
};

// A generator that produces buffer asynchrously.
export type BufferGenerator = AsyncGenerator<Buffer, void, void>;
