# HTTP Server from Scratch (TypeScript)

An HTTP/1.1 server written in TypeScript using only the `net` module. No Express, no `http` module. I built it to understand what happens between a `curl` command and the response, by parsing everything myself.

## Features

- HTTP/1.1 request parsing (request line and headers, with validation)
- Request bodies with `Content-Length` and chunked encoding
- Streaming responses using async generators
- Static file serving in 64KB chunks
- Range requests ( `206 Partial Content` )
- Caching with `ETag` , `Last-Modified` and `304 Not Modified`
- gzip compression using Node.js Streams and `zlib`
- HEAD method

## Run it

```bash
npm install
npx tsc
node dist/main.js
```

The server listens on `127.0.0.1:1234` .

## Endpoints

| Route               | Description                                       |
| ------------------- | ------------------------------------------------- |
| `GET /`             | Returns `hello world`                             |
| `POST /echo`        | Returns the request body                          |
| `GET /sheep`        | Sends one line per second (chunked encoding demo) |
| `GET /files/<path>` | Serves a file, with range and cache support       |

## Try it

Start the server, then run these in another terminal.

**Basic requests**

```bash
# GET: should return "hello world"
curl -i http://127.0.0.1:1234/

# POST: the body comes back as the response
curl -i -X POST --data-binary "hello" http://127.0.0.1:1234/echo
```

**Streaming**

```bash
# One line arrives every second (chunked encoding)
curl -N http://127.0.0.1:1234/sheep
```

**Files**

```bash
# Create a test file and fetch it. Look for ETag and Last-Modified in the headers
echo "0123456789" > test.txt
curl -i http://127.0.0.1:1234/files/test.txt

# Range request: returns 206 Partial Content with the body "01234"
curl -i -H "Range: bytes=0-4" http://127.0.0.1:1234/files/test.txt

# HEAD: same headers as GET, but no body
curl -I http://127.0.0.1:1234/files/test.txt
```

**Caching**

```bash
# Copy the ETag value from the file response above and send it back.
# The server should answer 304 Not Modified with no body
curl -i -H 'If-None-Match: "<etag>"' http://127.0.0.1:1234/files/test.txt
```

**Compression**

```bash
# Ask for gzip, then unzip it. You should see the original file content
curl -s -H "Accept-Encoding: gzip" http://127.0.0.1:1234/files/test.txt | gunzip
```

## Code structure

```
                 ┌─────────────────────────────┐
                 │           main.ts           │
                 │   serveClient / handleReq   │
                 │        writeHTTPResp        │
                 └──────────────┬──────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
  ┌─────────────┐       ┌───────────────┐      ┌────────────────┐
  │  net_io.ts  │       │ http_parser   │      │  http_io.ts    │
  │  soRead     │       │ cutMessage    │      │ readerFromReq  │
  │  soWrite    │       │ splitLines    │      │ fieldGet       │
  └──────┬──────┘       └───────┬───────┘      │ gzipFilter     │
         ▼                      ▼              └───────┬────────┘
  ┌──────────────────────────────────────────────────────────┐
  │                        dynbuf.ts                         │
  │  bufPush / bufPop / cutMessage (raw bytes, dynamic grow) │
  └──────────────────────────────────────────────────────────┘
```

| File             | What it does                                                             |
| ---------------- | ------------------------------------------------------------------------ |
| `net_io.ts`      | Wraps the TCP socket with promise-based `soRead` and `soWrite`           |
| `dynbuf.ts`      | Buffer that grows as bytes arrive                                        |
| `http_types.ts`  | Types: `HTTPReq` , `HTTPRes` , `BodyReader`                              |
| `http_parser.ts` | Splits bytes into headers, parses the request line                       |
| `http_io.ts`     | Reads bodies ( `Content-Length` and chunked), header lookup, gzip filter |
| `static_file.ts` | Opens a file and returns a streaming `BodyReader`                        |
| `range.ts`       | Parses `Range` headers ( `bytes=0-999` , `bytes=500-` , `bytes=-500` )   |
| `main.ts`        | Server loop, routing, response writer                                    |

## What I learned

**TCP has no messages.** My first version read from the socket and assumed it got a full request. That broke quickly. One read can return half a request or more than one. So I made `DynBuf` , which keeps adding bytes, and the parser only runs when a full header is in the buffer.

**Headers end at a blank line.** The parser reads until `\r\n\r\n` . Before that is headers, after that is the body. After I understood this, the rest of the parser was just splitting lines.

**Content-Length is not the only way.** When the sender doesn't know the size, it uses chunked encoding: a size in hex, then that many bytes, repeated until a zero-size chunk. I wrote a reader for both.

**Don't trust both headers together.** If a request has `Content-Length` and `Transfer-Encoding` , two servers can disagree on where the body ends. This is request smuggling.

**Responses have to stream too.** Large files can't be loaded into memory. `BodyReader` hides where the data comes from (memory, file, generator), and `writeHTTPResp` chooses `Content-Length` or chunked based on whether the size is known.

**Caching and ranges.** Caching is comparing `ETag` and `Last-Modified` with what the client sends and returning `304` with no body. Ranges were harder because of edge cases: clamping to file size, returning `416` for bad ranges, and a correct `Content-Range` header.

**gzip was really about streams.** `zlib` does the compression. My work was connecting `BodyReader` to Node.js Streams with `pipeline()` , which also handles backpressure when the client is slow.

**File handles need an owner.** They don't close on their own, so I had to decide where each one gets closed, including when a request fails midway.

After the basic parser worked, every new feature followed the same pattern: read a new header, add a new kind of `BodyReader` , add a branch in `handleReq` .

## Missing

- WebSockets
- TLS/HTTPS (would need a reverse proxy)
- HTTP/2 and HTTP/3
- Path traversal protection on `/files/` . Don't run this on an untrusted network.
