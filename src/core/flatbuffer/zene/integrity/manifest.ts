

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import * as flatbuffers from 'flatbuffers';

import { FileEntry } from '../../zene/integrity/file-entry.js';


export class Manifest {
  bb: flatbuffers.ByteBuffer|null = null;
  bb_pos = 0;
  __init(i:number, bb:flatbuffers.ByteBuffer):Manifest {
  this.bb_pos = i;
  this.bb = bb;
  return this;
}

static getRootAsManifest(bb:flatbuffers.ByteBuffer, obj?:Manifest):Manifest {
  return (obj || new Manifest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
}

static getSizePrefixedRootAsManifest(bb:flatbuffers.ByteBuffer, obj?:Manifest):Manifest {
  bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
  return (obj || new Manifest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
}

timestamp():bigint {
  const offset = this.bb!.__offset(this.bb_pos, 4);
  return offset ? this.bb!.readUint64(this.bb_pos + offset) : BigInt('0');
}

algorithm():string|null
algorithm(optionalEncoding:flatbuffers.Encoding):string|Uint8Array|null
algorithm(optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 6);
  return offset ? this.bb!.__string(this.bb_pos + offset, optionalEncoding) : null;
}

files(index: number, obj?:FileEntry):FileEntry|null {
  const offset = this.bb!.__offset(this.bb_pos, 8);
  return offset ? (obj || new FileEntry()).__init(this.bb!.__indirect(this.bb!.__vector(this.bb_pos + offset) + index * 4), this.bb!) : null;
}

filesLength():number {
  const offset = this.bb!.__offset(this.bb_pos, 8);
  return offset ? this.bb!.__vector_len(this.bb_pos + offset) : 0;
}

ignoreHash(index: number):string
ignoreHash(index: number,optionalEncoding:flatbuffers.Encoding):string|Uint8Array
ignoreHash(index: number,optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 10);
  return offset ? this.bb!.__string(this.bb!.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
}

ignoreHashLength():number {
  const offset = this.bb!.__offset(this.bb_pos, 10);
  return offset ? this.bb!.__vector_len(this.bb_pos + offset) : 0;
}

static startManifest(builder:flatbuffers.Builder) {
  builder.startObject(4);
}

static addTimestamp(builder:flatbuffers.Builder, timestamp:bigint) {
  builder.addFieldInt64(0, timestamp, BigInt('0'));
}

static addAlgorithm(builder:flatbuffers.Builder, algorithmOffset:flatbuffers.Offset) {
  builder.addFieldOffset(1, algorithmOffset, 0);
}

static addFiles(builder:flatbuffers.Builder, filesOffset:flatbuffers.Offset) {
  builder.addFieldOffset(2, filesOffset, 0);
}

static createFilesVector(builder:flatbuffers.Builder, data:flatbuffers.Offset[]):flatbuffers.Offset {
  builder.startVector(4, data.length, 4);
  for (let i = data.length - 1; i >= 0; i--) {
    builder.addOffset(data[i]!);
  }
  return builder.endVector();
}

static startFilesVector(builder:flatbuffers.Builder, numElems:number) {
  builder.startVector(4, numElems, 4);
}

static addIgnoreHash(builder:flatbuffers.Builder, ignoreHashOffset:flatbuffers.Offset) {
  builder.addFieldOffset(3, ignoreHashOffset, 0);
}

static createIgnoreHashVector(builder:flatbuffers.Builder, data:flatbuffers.Offset[]):flatbuffers.Offset {
  builder.startVector(4, data.length, 4);
  for (let i = data.length - 1; i >= 0; i--) {
    builder.addOffset(data[i]!);
  }
  return builder.endVector();
}

static startIgnoreHashVector(builder:flatbuffers.Builder, numElems:number) {
  builder.startVector(4, numElems, 4);
}

static endManifest(builder:flatbuffers.Builder):flatbuffers.Offset {
  const offset = builder.endObject();
  return offset;
}

static finishManifestBuffer(builder:flatbuffers.Builder, offset:flatbuffers.Offset) {
  builder.finish(offset);
}

static finishSizePrefixedManifestBuffer(builder:flatbuffers.Builder, offset:flatbuffers.Offset) {
  builder.finish(offset, undefined, true);
}

static createManifest(builder:flatbuffers.Builder, timestamp:bigint, algorithmOffset:flatbuffers.Offset, filesOffset:flatbuffers.Offset, ignoreHashOffset:flatbuffers.Offset):flatbuffers.Offset {
  Manifest.startManifest(builder);
  Manifest.addTimestamp(builder, timestamp);
  Manifest.addAlgorithm(builder, algorithmOffset);
  Manifest.addFiles(builder, filesOffset);
  Manifest.addIgnoreHash(builder, ignoreHashOffset);
  return Manifest.endManifest(builder);
}
}
