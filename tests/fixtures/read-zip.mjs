import assert from 'node:assert/strict';

// Independent reader for the uncompressed ZIP entries produced by media packages.
export function readPackageZip(bytes) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  const count = bytes.readUInt16LE(end + 10);
  let central = bytes.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(central), 0x02014b50);
    assert.equal(bytes.readUInt16LE(central + 10), 0);
    const size = bytes.readUInt32LE(central + 24);
    const nameLength = bytes.readUInt16LE(central + 28);
    const extraLength = bytes.readUInt16LE(central + 30);
    const commentLength = bytes.readUInt16LE(central + 32);
    const local = bytes.readUInt32LE(central + 42);
    const name = bytes.toString('utf8', central + 46, central + 46 + nameLength);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    const offset = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    assert.ok(offset + size <= central);
    assert.ok(!entries.has(name));
    assert.ok(!name.startsWith('/') && !name.includes('..') && !name.includes('\\'));
    entries.set(name, bytes.subarray(offset, offset + size));
    central += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(central, end);
  return entries;
}
