/// <reference types="node" />

/** Text, or UTF-8 bytes, passed to the native library. */
export type BytesLike = string | Buffer | ArrayBufferView | ArrayBuffer;

export const SUCCESS: 0;
export const INSUFFICIENT_CAPACITY: 1;

export const ParseMode: Readonly<{
    JSON: 1;
    JSON_VALIDATE: 2;
    JSON_VALIDATE_ACK: 3;
}>;
export type ParseMode = (typeof ParseMode)[keyof typeof ParseMode];

export const LogLevel: Readonly<{
    TRACE: 0;
    DEBUG: 1;
    INFORMATION: 2;
    WARNING: 3;
    ERROR: 4;
    ALL: 5;
}>;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export const ErrorCode: Readonly<{
    SUCCESS: 0;
    INSUFFICIENT_CAPACITY: 1;
    UNKNOWN: 501;
    NO_CONNECTION: 502;
    MODEL_MAP_INVALID: 503;
    INCORRECT_INPUT: 611;
    LOGGER_INITIALIZATION: 612;
    MAP_DESERIALIZATION: 613;
    INCORRECT_CAPACITY: 614;
    MAP_NOT_SET: 615;
    INCORRECT_MODE: 616;
    NO_JSON: 617;
    VALIDATION_UNAVAILABLE: 618;
    VALIDATION_SERIALIZATION: 619;
    INCORRECT_TOKEN: 620;
    CONFIG_DESERIALIZATION: 621;
    SPLIT_SEGMENT_ID_MISSING: 622;
    SPLIT_NOT_STARTED: 623;
    NO_RESULT: 624;
    RESULT_SIZE_MISMATCH: 625;
    MERGE_NOT_STARTED: 626;
    INCORRECT_OUTPUT_POINTER: 627;
    INCORRECT_SERIAL: 628;
    LICENSE_NOT_INSTALLED: 629;
    APP_VERSION_EXCEEDED: 630;
    TOKEN_EXPIRED: 631;
    TOKEN_MISSING: 632;
    MAX_LICENSES_EXCEEDED: 633;
    LICENSE_SNAPSHOT_MISSING: 634;
    LICENSE_NOT_SET: 635;
    RATE_EXCEEDED: 636;
    INVALID_JSON: 637;
    INCORRECT_LICENSE: 638;
    LICENSE_QUOTA_EXCEEDED: 639;
}>;

/** Thrown when a native call returns a non-zero status code. */
export class EdiFabricError extends Error {
    constructor(code: number, nativeMessage: string, api?: string);
    readonly code: number;
    readonly nativeMessage: string;
    readonly api: string;
}

/** Unwrapped C functions, keyed by their ABI names. Pointers are BigInt. */
export interface RawFunctions {
    [name: string]: ((...args: any[]) => any) | null;
    get_error(errorCode: number): bigint | null;
    free_error: ((pointer: bigint) => void) | null;
}

export interface NativeLibrary {
    /** Absolute path of the loaded library file. */
    path: string;
    /** The koffi library handle. */
    lib: unknown;
    raw: RawFunctions;
}

export interface ParseResult {
    output: string;
    /** String index in output where the validation/acknowledgment report starts; 0 for mode 1. */
    offset: number;
}

export interface SplitStep {
    size: number;
    offset: number;
    isLast: boolean;
}

export interface SplitPayload {
    payload: Buffer;
    offset: number;
    isLast: boolean;
}

export function libraryFilename(): string;
export function loadLibrary(libraryPath?: string): NativeLibrary;

export function decodeString(pointer: bigint): string;
export function freeError(pointer: bigint | null): void;
export function getError(errorCode: number): string;
export function check(rc: number, api?: string): void;

export function initLogger(logPath: BytesLike, minLevel?: LogLevel): void;
export function shutdownLogger(): void;
export function clearCache(): void;

export function ensureToken(serial: BytesLike, seconds: number): void;
export function getAppVersion(): number;
export function getToken(serial: BytesLike, capacity?: number): string;
export function validateToken(token: BytesLike): void;
export function setToken(token: BytesLike): void;
/** Token expiry as .NET UTC ticks; 0n when no token is set. */
export function getTokenExpiration(): bigint;
export function setSerial(serial: BytesLike): void;

export function setMap(mapJson: BytesLike): void;

export function parse(edi: BytesLike, mode?: ParseMode, config?: BytesLike | null, capacity?: number | null): ParseResult;
export function startSplit(edi: BytesLike, mode?: ParseMode, config?: BytesLike | null): void;
export function split(): SplitStep;
export function build(json: BytesLike, postfix?: string | null, capacity?: number | null): string;
export function startMerge(json: BytesLike): void;
export function merge(): number;
export function getResult(size: number): Buffer;

export function iterSplit(edi: BytesLike, mode?: ParseMode, config?: BytesLike | null): Generator<SplitPayload, void, void>;
export function iterMerge(json: BytesLike): Generator<Buffer, void, void>;
