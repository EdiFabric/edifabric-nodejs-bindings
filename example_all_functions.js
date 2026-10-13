/*
 * Walkthrough of every function in the ediFabric Native X12 C ABI.
 *
 * Each section calls one group of entry points and prints the result, so the
 * output doubles as a reference for what each call returns.
 *
 * Usage:
 *     node example_all_functions.js
 *     node example_all_functions.js --serial YOUR_SERIAL
 *     node example_all_functions.js --lib /path/to/edifabric-x12-tools.dll
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');

const ef = require('./edifabric-x12');

// Free plan serial published in the ediFabric Native documentation.
const DEFAULT_SERIAL = 'bd96a836feca45cb91c86ee65d281f52';

const ROOT = __dirname;
const MAP_PATH = path.join(ROOT, 'map', 'map.json');
const SAMPLE_EDI_PATH = path.join(ROOT, 'edi', '837p.txt');
const SAMPLE_EDI_INVALID_PATH = path.join(ROOT, 'edi', '837p_error.txt');

const SAMPLE_EDI = fs.readFileSync(SAMPLE_EDI_PATH, 'utf8');
const SAMPLE_EDI_INVALID = fs.readFileSync(SAMPLE_EDI_INVALID_PATH, 'utf8');

// Validation levels are 0 - no validation; 1 - syntax only; 2 - limits and codes; 3 - balancing; 4 - inter segment. The levels match the HIPAA SNIP validation levels.
const PARSE_CONFIG = {
    validate: {
        regex: null,
        date_format: null,
        time_format: null,
        skip_seq_count: false,
        skip_hl_seq: false,
        snip_level: 4,
        max_errors: 100,
    },
    ack: {
        supress_ta1: false,
        ak901p: false,
        gen_for_valid: true,
        gen997: false,
    },
};

const SPLIT_CONFIG = { ...PARSE_CONFIG, split: { segment_id: 'LX', segment_depth: 6, loop_id: '2400' } };

// .NET DateTime ticks are 100ns intervals since year 1; the Unix epoch is 62135596800000 ms later.
const TICKS_PER_MILLISECOND = 10000n;
const DOTNET_EPOCH_MS = -62135596800000n;

function section(title) {
    console.log();
    console.log('='.repeat(70));
    console.log(title);
    console.log('='.repeat(70));
}

function preview(text, limit = 400) {
    return text.length <= limit ? text : `${text.slice(0, limit)} ...`;
}

function ticksToUtc(ticks) {
    if (!ticks) return 'no token set';
    return new Date(Number(DOTNET_EPOCH_MS + ticks / TICKS_PER_MILLISECOND)).toISOString();
}

/** Load map/map.json and point each entry at the local map folder. */
function loadLocalMap() {
    const modelMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
    const mapDir = path.dirname(MAP_PATH);
    for (const entry of Object.values(modelMap.maps || {})) entry.location = mapDir;
    return modelMap;
}

/** Load map/map.json and resolve unmapped transaction sets online with the serial. */
function loadOnlineMap(serial) {
    const modelMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
    modelMap.default = serial;
    return modelMap;
}

/** getError, freeError */
function demoErrors(library) {
    section('Error messages: getError, freeError');

    for (const code of [ef.ErrorCode.INSUFFICIENT_CAPACITY, ef.ErrorCode.MAP_NOT_SET, ef.ErrorCode.LICENSE_NOT_SET]) {
        console.log(`  getError(${String(code).padStart(3)}) -> ${ef.getError(code)}`);
    }

    // The raw export hands back a heap pointer that the caller owns.
    const pointer = library.raw.get_error(ef.ErrorCode.TOKEN_EXPIRED);
    const message = ef.decodeString(pointer);
    ef.freeError(pointer);
    console.log(`  raw get_error(631) -> ${message}`);
    console.log('  freeError(pointer) released the string');
}

/** initLogger, getAppVersion */
function demoLogging(logPath) {
    section('Lifecycle: initLogger, getAppVersion');

    ef.initLogger(logPath, ef.LogLevel.TRACE);
    console.log(`  initLogger -> logging to ${logPath}`);
    console.log(`  getAppVersion -> ${ef.getAppVersion()}`);
}

function printMap(modelMap) {
    const keys = Object.keys(modelMap.maps || {}).join(', ') || '(none)';
    console.log(`  setMap <- ${path.relative(ROOT, MAP_PATH)}`);
    console.log(`  default=${JSON.stringify(modelMap.default)}, local maps=${keys}`);
}

/** setMap */
function demoSetOnlineMap(serial) {
    section('Model map: setMap online, default is the serial key');

    const modelMap = loadOnlineMap(serial);
    ef.setMap(JSON.stringify(modelMap));
    printMap(modelMap);
}

/** setMap */
function demoSetLocalMap() {
    section('Model map: setMap local, default is blank');

    const modelMap = loadLocalMap();
    ef.setMap(JSON.stringify(modelMap));
    printMap(modelMap);
}

/** parse in mode 1 */
function demoParse() {
    section('Parse: parse (mode 1, JSON only)');

    const { output, offset } = ef.parse(SAMPLE_EDI, ef.ParseMode.JSON);
    console.log(`  ${output.length} chars of JSON, offset=${offset}`);
    console.log(`  ${preview(output)}`);
    return output;
}

/** parse in mode 2 */
function demoParseValidate() {
    section('Parse: parse (mode 2, JSON + validation report)');

    const { output, offset } = ef.parse(SAMPLE_EDI_INVALID, ef.ParseMode.JSON_VALIDATE, JSON.stringify(PARSE_CONFIG));
    console.log(`  ${output.length} chars total, validation starts at offset ${offset}`);
    console.log(`  validation -> ${preview(output.slice(offset))}`);
}

/** parse in mode 3 */
function demoParseAck(title, edi) {
    section(title);

    const { output, offset } = ef.parse(edi, ef.ParseMode.JSON_VALIDATE_ACK, JSON.stringify(PARSE_CONFIG));
    console.log(`  ${output.length} chars total, report starts at offset ${offset}`);
    console.log(`  report -> ${preview(output.slice(offset), 600)}`);
}

/** startSplit, split, getResult */
function demoSplit() {
    section('Split: startSplit, split, getResult');

    ef.startSplit(SAMPLE_EDI, ef.ParseMode.JSON, JSON.stringify(SPLIT_CONFIG));
    for (let step = 1; ; step++) {
        const { size, offset, isLast } = ef.split();
        const payload = size > 0 ? ef.getResult(size).toString('utf8') : '';
        console.log(`  step ${step}: size=${size} offset=${offset} last=${isLast}`);
        if (payload) console.log(`    ${preview(payload, 160)}`);
        if (isLast) break;
    }
}

/** build */
function demoBuild(parsedJson) {
    section('Build: build');

    const edi = ef.build(parsedJson, '\r\n');
    console.log(`  ${edi.length} chars of X12`);
    console.log(`  ${edi.replace(/\r\n/g, '\n  ').trimEnd()}`);
    return edi;
}

/** startMerge, merge, getResult */
function demoMerge(parsedJson) {
    section('Merge: startMerge, merge, getResult');

    ef.startMerge(parsedJson);
    let count = 0;
    for (;;) {
        const size = ef.merge();
        if (size === 0) break;
        const segment = ef.getResult(size).toString('utf8');
        count++;
        console.log(`  segment ${String(count).padStart(2)}: ${segment}`);
    }
    console.log(`  merge produced ${count} segments`);
}

/** iterSplit, iterMerge convenience wrappers */
function demoIterators(parsedJson) {
    section('Convenience wrappers: iterSplit, iterMerge');

    const parts = [...ef.iterSplit(SAMPLE_EDI, ef.ParseMode.JSON, JSON.stringify(SPLIT_CONFIG))];
    console.log(`  iterSplit -> ${parts.length} payloads, sizes [${parts.map((p) => p.payload.length).join(', ')}]`);

    const segments = [...ef.iterMerge(parsedJson)];
    console.log(`  iterMerge -> ${segments.length} segments`);
}

/** getTokenExpiration */
function demoTokenExpiration() {
    section('Licensing: getTokenExpiration');

    const ticks = ef.getTokenExpiration();
    console.log(`  getTokenExpiration -> ${ticks} (${ticksToUtc(ticks)})`);
}

/** clearCache, shutdownLogger */
function demoTeardown() {
    section('Teardown: clearCache, shutdownLogger');

    ef.clearCache();
    console.log('  clearCache -> map, license, stream state and results reset');
    ef.shutdownLogger();
    console.log('  shutdownLogger -> logger stopped');
}

function main() {
    const { values: args } = parseArgs({
        options: {
            serial: { type: 'string' },
            lib: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
    });

    if (args.help) {
        console.log('ediFabric Native X12: every ABI function');
        console.log('  --serial  license serial (default: EDIFABRIC_SERIAL or the free plan serial)');
        console.log('  --lib     path to edifabric-x12-tools.dll/.so/.dylib or its folder');
        return 0;
    }

    const serial = args.serial || process.env.EDIFABRIC_SERIAL || DEFAULT_SERIAL;

    section('Load: loadLibrary');
    const library = ef.loadLibrary(args.lib);
    console.log(`  loaded ${library.path}`);

    demoErrors(library);

    let exitCode = 0;

    try {
        demoLogging('edifabric.log');

        try {
            // Community authorizes with the serial only. Developer can also use ensureToken, Enterprise setToken.
            ef.setSerial(serial);
            console.log('  setSerial -> ok');

            demoTokenExpiration();

            demoSetLocalMap();

            const parsedJson = demoParse();

            demoSetOnlineMap(serial);

            demoParseValidate();
            demoParseAck('Parse: parse (mode 3, JSON + validation + acknowledgment)', SAMPLE_EDI);
            demoParseAck('Parse: parse (mode 3, invalid file, JSON + validation + acknowledgment)', SAMPLE_EDI_INVALID);
            demoSplit();
            demoBuild(parsedJson);
            demoMerge(parsedJson);
            demoIterators(parsedJson);
            demoTeardown();
        } catch (error) {
            if (!(error instanceof ef.EdiFabricError)) throw error;
            console.error(`\n${error.message}`);
            console.error(
                'Check that the serial is valid and that map/map.json resolves the ' +
                    'transaction set to a local model file under map/.'
            );
            exitCode = 1;
        }
    } finally {
        // Release the log file. On the success path demoTeardown already shut the logger down.
        try {
            ef.shutdownLogger();
        } catch (error) {
            if (!(error instanceof ef.EdiFabricError)) throw error;
        }
    }

    if (exitCode) return exitCode;

    section('Finished');
    console.log('Every entry point in c-abi-edifabric_x12_tools.h was called.');
    return 0;
}

process.exitCode = main();
