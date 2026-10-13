/*
 * Node.js bindings for ediFabric Native X12 (see c-abi-edifabric_x12_tools.h).
 *
 * Load the platform shared library (edifabric-x12-tools.dll / .so / .dylib) and call
 * the wrappers below. All payloads cross the boundary as UTF-8 byte buffers.
 * Native return codes: 0 = success, 1 = InsufficientCapacity (grow-and-retry),
 * anything else is an error whose message comes from getError.
 *
 * The wrappers handle grow-and-retry internally and throw EdiFabricError on failure.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const koffi = require('koffi');

const SUCCESS = 0;
const INSUFFICIENT_CAPACITY = 1;

/** mode argument for parse / startSplit. */
const ParseMode = Object.freeze({
    JSON: 1,
    JSON_VALIDATE: 2,
    JSON_VALIDATE_ACK: 3,
});

/** minLevel argument for initLogger. */
const LogLevel = Object.freeze({
    TRACE: 0,
    DEBUG: 1,
    INFORMATION: 2,
    WARNING: 3,
    ERROR: 4,
    ALL: 5,
});

/** Library-level error codes. Validation codes come from the engine. */
const ErrorCode = Object.freeze({
    SUCCESS: 0,
    INSUFFICIENT_CAPACITY: 1,
    UNKNOWN: 501,
    NO_CONNECTION: 502,
    MODEL_MAP_INVALID: 503,
    INCORRECT_INPUT: 611,
    LOGGER_INITIALIZATION: 612,
    MAP_DESERIALIZATION: 613,
    INCORRECT_CAPACITY: 614,
    MAP_NOT_SET: 615,
    INCORRECT_MODE: 616,
    NO_JSON: 617,
    VALIDATION_UNAVAILABLE: 618,
    VALIDATION_SERIALIZATION: 619,
    INCORRECT_TOKEN: 620,
    CONFIG_DESERIALIZATION: 621,
    SPLIT_SEGMENT_ID_MISSING: 622,
    SPLIT_NOT_STARTED: 623,
    NO_RESULT: 624,
    RESULT_SIZE_MISMATCH: 625,
    MERGE_NOT_STARTED: 626,
    INCORRECT_OUTPUT_POINTER: 627,
    INCORRECT_SERIAL: 628,
    LICENSE_NOT_INSTALLED: 629,
    APP_VERSION_EXCEEDED: 630,
    TOKEN_EXPIRED: 631,
    TOKEN_MISSING: 632,
    MAX_LICENSES_EXCEEDED: 633,
    LICENSE_SNAPSHOT_MISSING: 634,
    LICENSE_NOT_SET: 635,
    RATE_EXCEEDED: 636,
    INVALID_JSON: 637,
    INCORRECT_LICENSE: 638,
    LICENSE_QUOTA_EXCEEDED: 639,
});

/** Thrown when a native call returns a non-zero status code. */
class EdiFabricError extends Error {
    constructor(code, nativeMessage, api = '') {
        super(`${api ? `${api}: ` : ''}error ${code}: ${nativeMessage}`);
        this.name = 'EdiFabricError';
        this.code = code;
        this.nativeMessage = nativeMessage;
        this.api = api;
    }
}

let native = null;

// ---------------------------------------------------------------------------
// Library loading
// ---------------------------------------------------------------------------

function libraryFilename() {
    if (process.platform === 'win32') return 'edifabric-x12-tools.dll';
    if (process.platform === 'darwin') return 'edifabric-x12-tools.dylib';
    return 'edifabric-x12-tools.so';
}

function isDirectory(candidate) {
    try {
        return fs.statSync(candidate).isDirectory();
    } catch {
        return false;
    }
}

function isFile(candidate) {
    try {
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
}

function candidates(explicit) {
    const name = libraryFilename();
    const found = [];
    const resolve = (value) => (isDirectory(value) ? path.join(value, name) : value);
    if (explicit) found.push(resolve(path.resolve(explicit)));
    if (process.env.EDIFABRIC_X12_LIB) found.push(resolve(path.resolve(process.env.EDIFABRIC_X12_LIB)));
    found.push(path.join(__dirname, name), path.join(__dirname, '..', name), path.join(process.cwd(), name));
    return found;
}

const SIGNATURES = [
    'int init_logger(const uint8_t *path, int path_len, int min_level)',
    'int shutdown_logger()',
    'int clear_cache()',
    'int ensure_token(const uint8_t *serial, int serial_len, int seconds)',
    'int get_app_version(_Out_ int *app_version)',
    'int get_token(const uint8_t *serial, int serial_len, uint8_t *output, int output_capacity, _Out_ int *output_length)',
    'int validate_token(const uint8_t *token, int token_len)',
    'int set_token(const uint8_t *token, int token_len)',
    'int get_token_expiration(uint8_t *expiration_utc)',
    'int set_serial(const uint8_t *serial, int serial_len)',
    'int set_map(const uint8_t *map, int map_length)',
    'int parse(const uint8_t *input, int input_length, int mode, const uint8_t *config, int config_length, ' +
        'uint8_t *output, int output_capacity, _Out_ int *output_length, _Out_ int *output_offset)',
    'int start_split(const uint8_t *input, int input_length, int mode, const uint8_t *config, int config_length)',
    'int split(_Out_ int *result_size, _Out_ int *result_offset, _Out_ uint8_t *last)',
    'int build(const uint8_t *input, int input_length, const char *postfix, ' +
        'uint8_t *output, int output_capacity, _Out_ int *output_length)',
    'int start_merge(const uint8_t *input, int input_length)',
    'int merge(_Out_ int *result_size)',
    'int get_result(uint8_t *buffer, int buffer_size)',
    'void *get_error(int error_code)',
];

function bind(libraryPath) {
    const lib = koffi.load(libraryPath);
    const raw = {};
    for (const signature of SIGNATURES) {
        const name = /\*?(\w+)\(/.exec(signature)[1];
        raw[name] = lib.func(signature);
    }
    try {
        raw.free_error = lib.func('void free_error(void *ptr)');
    } catch {
        raw.free_error = null;
    }
    return { path: libraryPath, lib, raw };
}

/**
 * Load and bind the native library.
 *
 * libraryPath may be the library file or the folder containing it. When omitted, the
 * EDIFABRIC_X12_LIB variable, this module's folder, its parent, and the current
 * working directory are tried in that order. Cached after the first success.
 *
 * Returns { path, lib, raw }; raw holds the unwrapped C functions by their ABI names.
 */
function loadLibrary(libraryPath) {
    if (native && !libraryPath) return native;

    let lastError = null;
    const tried = candidates(libraryPath);
    for (const candidate of tried) {
        if (!isFile(candidate)) continue;
        try {
            native = bind(candidate);
            return native;
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(
        `Could not load ${libraryFilename()}. Tried: ${tried.join(', ')}. Last error: ${lastError ? lastError.message : 'none'}`
    );
}

function raw() {
    return (native || loadLibrary()).raw;
}

// ---------------------------------------------------------------------------
// Buffer / error helpers
// ---------------------------------------------------------------------------

/** Return [buffer, length]; [null, 0] for null/undefined so the ABI receives a null pointer. */
function utf8(data) {
    if (data === null || data === undefined) return [null, 0];
    let buffer;
    if (typeof data === 'string') buffer = Buffer.from(data, 'utf8');
    else if (Buffer.isBuffer(data)) buffer = data;
    else if (ArrayBuffer.isView(data)) buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    else if (data instanceof ArrayBuffer) buffer = Buffer.from(data);
    else throw new TypeError('Expected a string, Buffer, TypedArray, or ArrayBuffer');
    return [buffer, buffer.length];
}

let crtFree;

/** Fallback for builds that do not export free_error. */
function crtFreeFunction() {
    if (crtFree !== undefined) return crtFree;
    const names = {
        win32: ['ucrtbase.dll', 'msvcrt.dll'],
        darwin: ['libSystem.B.dylib'],
    }[process.platform] || ['libc.so.6', 'libc.so'];
    crtFree = null;
    for (const name of names) {
        try {
            crtFree = koffi.load(name).func('void free(void *ptr)');
            break;
        } catch {
            // try the next runtime
        }
    }
    return crtFree;
}

/**
 * Release a string returned by the raw get_error export.
 *
 * getError() below already does this; call freeError only when you invoke the
 * raw export yourself.
 */
function freeError(pointer) {
    if (!pointer) return;
    const fns = raw();
    if (fns.free_error) {
        fns.free_error(pointer);
        return;
    }
    const free = crtFreeFunction();
    if (free) free(pointer);
}

/** Decode a NUL-terminated native string pointer. */
function decodeString(pointer) {
    return koffi.decode(pointer, 'char', -1);
}

/** Return the message for an error code, releasing the native string. */
function getError(errorCode) {
    const pointer = raw().get_error(Number(errorCode));
    if (!pointer) return `Unknown error ${errorCode}`;
    try {
        return decodeString(pointer) || `Unknown error ${errorCode}`;
    } finally {
        freeError(pointer);
    }
}

/** Throw EdiFabricError unless rc is SUCCESS. */
function check(rc, api = '') {
    if (rc !== SUCCESS) throw new EdiFabricError(rc, getError(rc), api);
}

/** Run a grow-and-retry output call; call(buffer, capacity, outLength) -> rc. */
function withGrowth(capacity, api, call) {
    let cap = Math.max(1, Math.floor(capacity));
    for (;;) {
        const buffer = Buffer.alloc(cap);
        const outLength = [0];
        const rc = call(buffer, cap, outLength);
        if (rc === INSUFFICIENT_CAPACITY) {
            cap = outLength[0] > cap ? outLength[0] : cap * 2;
            continue;
        }
        check(rc, api);
        return buffer.subarray(0, outLength[0]);
    }
}

// ---------------------------------------------------------------------------
// Lifecycle and logging
// ---------------------------------------------------------------------------

/** Write a log file at logPath; minLevel is 0=Trace through 4=Error. */
function initLogger(logPath, minLevel = LogLevel.INFORMATION) {
    const [buffer, length] = utf8(logPath);
    check(raw().init_logger(buffer, length, minLevel), 'init_logger');
}

/** Flush and stop the logger. */
function shutdownLogger() {
    check(raw().shutdown_logger(), 'shutdown_logger');
}

/** Reset the model map, split/merge state, last result, license, and logger. */
function clearCache() {
    check(raw().clear_cache(), 'clear_cache');
}

// ---------------------------------------------------------------------------
// Licensing
// ---------------------------------------------------------------------------

/**
 * Cache a token for runtime authorization against the license server.
 *
 * Retrieves a new token if the cached token expires within the specified
 * number of seconds.
 */
function ensureToken(serial, seconds) {
    const [buffer, length] = utf8(serial);
    check(raw().ensure_token(buffer, length, seconds), 'ensure_token');
}

/** Return the library application version. */
function getAppVersion() {
    const version = [0];
    check(raw().get_app_version(version), 'get_app_version');
    return version[0];
}

/** Fetch a signed license token for the serial. Requires internet access. */
function getToken(serial, capacity = 4096) {
    const [serialBuffer, serialLength] = utf8(serial);
    return withGrowth(capacity, 'get_token', (buffer, cap, outLength) =>
        raw().get_token(serialBuffer, serialLength, buffer, cap, outLength)
    ).toString('utf8');
}

/** Validate a token without caching it. */
function validateToken(token) {
    const [buffer, length] = utf8(token);
    check(raw().validate_token(buffer, length), 'validate_token');
}

/** Cache a token for this process. */
function setToken(token) {
    const [buffer, length] = utf8(token);
    check(raw().set_token(buffer, length), 'set_token');
}

/** Return token expiry as .NET UTC ticks (BigInt); 0n when no token is set. */
function getTokenExpiration() {
    const expiration = Buffer.alloc(8);
    check(raw().get_token_expiration(expiration), 'get_token_expiration');
    return os.endianness() === 'LE' ? expiration.readBigInt64LE(0) : expiration.readBigInt64BE(0);
}

/** Cache a serial for runtime authorization against the license server. */
function setSerial(serial) {
    const [buffer, length] = utf8(serial);
    check(raw().set_serial(buffer, length), 'set_serial');
}

// ---------------------------------------------------------------------------
// Model map
// ---------------------------------------------------------------------------

/** Load the template map JSON. Call once before parse or startSplit. */
function setMap(mapJson) {
    const [buffer, length] = utf8(mapJson);
    check(raw().set_map(buffer, length), 'set_map');
}

// ---------------------------------------------------------------------------
// Parse, split, build, merge
// ---------------------------------------------------------------------------

/**
 * Parse a whole interchange and return { output, offset }.
 *
 * offset is 0 for mode 1; for modes 2 and 3 it marks where the validation and
 * acknowledgment section begins inside output, as a string index.
 */
function parse(edi, mode = ParseMode.JSON, config = null, capacity = null) {
    const [inputBuffer, inputLength] = utf8(edi);
    const [configBuffer, configLength] = utf8(config);
    let cap = capacity !== null && capacity !== undefined ? capacity : Math.max(4096, inputLength * 12);

    for (;;) {
        const buffer = Buffer.alloc(cap);
        const outLength = [0];
        const outOffset = [0];
        const rc = raw().parse(
            inputBuffer, inputLength, mode, configBuffer, configLength, buffer, cap, outLength, outOffset
        );
        if (rc === INSUFFICIENT_CAPACITY) {
            cap = outLength[0] > cap ? outLength[0] : cap * 2;
            continue;
        }
        check(rc, 'parse');
        // The native offset counts bytes; convert it so output.slice(offset) works on the string.
        const head = buffer.toString('utf8', 0, outOffset[0]);
        const tail = buffer.toString('utf8', outOffset[0], outLength[0]);
        return { output: head + tail, offset: head.length };
    }
}

/** Begin a streaming split. config must contain a split section with segment_id. */
function startSplit(edi, mode = ParseMode.JSON, config = null) {
    const [inputBuffer, inputLength] = utf8(edi);
    const [configBuffer, configLength] = utf8(config);
    check(raw().start_split(inputBuffer, inputLength, mode, configBuffer, configLength), 'start_split');
}

/**
 * Advance the split stream and return { size, offset, isLast }.
 *
 * Fetch the payload with getResult(size) whenever size is greater than zero.
 */
function split() {
    const size = [0];
    const offset = [0];
    const last = [0];
    check(raw().split(size, offset, last), 'split');
    return { size: size[0], offset: offset[0], isLast: Boolean(last[0]) };
}

/**
 * Build X12 EDI from transaction-set JSON.
 *
 * postfix is appended after each segment terminator, for example "\r\n".
 * Pass null for compact single-line output.
 */
function build(json, postfix = null, capacity = null) {
    const [inputBuffer, inputLength] = utf8(json);
    const cap = capacity !== null && capacity !== undefined ? capacity : Math.max(4096, inputLength);
    return withGrowth(cap, 'build', (buffer, current, outLength) =>
        raw().build(inputBuffer, inputLength, postfix, buffer, current, outLength)
    ).toString('utf8');
}

/** Begin a streaming merge from a full interchange JSON document. */
function startMerge(json) {
    const [buffer, length] = utf8(json);
    check(raw().start_merge(buffer, length), 'start_merge');
}

/** Return the size of the next segment, or 0 at the end of the stream. */
function merge() {
    const size = [0];
    check(raw().merge(size), 'merge');
    return size[0];
}

/** Copy the last split or merge result as a Buffer. size must match the reported size. */
function getResult(size) {
    if (!Number.isInteger(size) || size < 0) throw new RangeError('size must be an integer of zero or greater');
    const buffer = Buffer.alloc(size);
    check(raw().get_result(buffer, size), 'get_result');
    return buffer;
}

// ---------------------------------------------------------------------------
// Convenience iterators
// ---------------------------------------------------------------------------

/** Yield { payload, offset, isLast } for every split step that produces data. */
function* iterSplit(edi, mode = ParseMode.JSON, config = null) {
    startSplit(edi, mode, config);
    for (;;) {
        const { size, offset, isLast } = split();
        if (size > 0) yield { payload: getResult(size), offset, isLast };
        if (isLast) break;
    }
}

/** Yield each X12 segment produced by a merge stream as a Buffer. */
function* iterMerge(json) {
    startMerge(json);
    for (;;) {
        const size = merge();
        if (size === 0) break;
        yield getResult(size);
    }
}

module.exports = {
    SUCCESS,
    INSUFFICIENT_CAPACITY,
    ParseMode,
    LogLevel,
    ErrorCode,
    EdiFabricError,
    libraryFilename,
    loadLibrary,
    decodeString,
    freeError,
    getError,
    check,
    initLogger,
    shutdownLogger,
    clearCache,
    ensureToken,
    getAppVersion,
    getToken,
    validateToken,
    setToken,
    getTokenExpiration,
    setSerial,
    setMap,
    parse,
    startSplit,
    split,
    build,
    startMerge,
    merge,
    getResult,
    iterSplit,
    iterMerge,
};
