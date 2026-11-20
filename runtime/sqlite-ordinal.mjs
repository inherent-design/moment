import {fail} from './json.mjs';

/** Decode an exact SQLite signed-64-bit ordinal; never round an observed row ID. */
export function sqliteOrdinal(value) {
  let integer;
  if(typeof value==='bigint')integer=value;
  else if(typeof value==='number'&&Number.isSafeInteger(value))integer=BigInt(value);
  else if(typeof value==='string'&&/^-?(?:0|[1-9][0-9]*)$/.test(value))integer=BigInt(value);
  else fail('INVALID_ARGUMENT','SQLite order requires an exact signed integer');
  if(integer<-(1n<<63n)||integer>=(1n<<63n))fail('INVALID_ARGUMENT','SQLite order is outside signed 64-bit ordinals');
  return integer;
}

/** Preserve existing safe numeric cursor bytes; encode larger ordinals as text. */
export function sqliteOrdinalValue(value) {
  const integer=sqliteOrdinal(value),safe=BigInt(Number.MAX_SAFE_INTEGER);
  return integer>=-safe&&integer<=safe?Number(integer):integer.toString();
}
