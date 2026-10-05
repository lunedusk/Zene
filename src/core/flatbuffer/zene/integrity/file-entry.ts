

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import * as flatbuffers from 'flatbuffers';

export class FileEntry {
  bb: flatbuffers.ByteBuffer|null = null;
  bb_pos = 0;
  __init(i:number, bb:flatbuffers.ByteBuffer):FileEntry {
  this.bb_pos = i;
  this.bb = bb;
  return this;
}

static getRootAsFileEntry(bb:flatbuffers.ByteBuffer, obj?:FileEntry):FileEntry {
  return (obj || new FileEntry()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
}

static getSizePrefixedRootAsFileEntry(bb:flatbuffers.ByteBuffer, obj?:FileEntry):FileEntry {
  bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
  return (obj || new FileEntry()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
}

path():string|null
path(optionalEncoding:flatbuffers.Encoding):string|Uint8Array|null
path(optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 4);
  return offset ? this.bb!.__string(this.bb_pos + offset, optionalEncoding) : null;
}

hash(index: number):number|null {
  const offset = this.bb!.__offset(this.bb_pos, 6);
  return offset ? this.bb!.readUint8(this.bb!.__vector(this.bb_pos + offset) + index) : 0;
}

hashLength():number {
  const offset = this.bb!.__offset(this.bb_pos, 6);
  return offset ? this.bb!.__vector_len(this.bb_pos + offset) : 0;
}

hashArray():Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 6);
  return offset ? new Uint8Array(this.bb!.bytes().buffer, this.bb!.bytes().byteOffset + this.bb!.__vector(this.bb_pos + offset), this.bb!.__vector_len(this.bb_pos + offset)) : null;
}

size():number {
  const offset = this.bb!.__offset(this.bb_pos, 8);
  return offset ? this.bb!.readUint32(this.bb_pos + offset) : 0;
}

static startFileEntry(builder:flatbuffers.Builder) {
  builder.startObject(3);
}

static addPath(builder:flatbuffers.Builder, pathOffset:flatbuffers.Offset) {
  builder.addFieldOffset(0, pathOffset, 0);
}

static addHash(builder:flatbuffers.Builder, hashOffset:flatbuffers.Offset) {
  builder.addFieldOffset(1, hashOffset, 0);
}

static createHashVector(builder:flatbuffers.Builder, data:number[]|Uint8Array):flatbuffers.Offset {
  builder.startVector(1, data.length, 1);
  for (let i = data.length - 1; i >= 0; i--) {
    builder.addInt8(data[i]!);
  }
  return builder.endVector();
}

static startHashVector(builder:flatbuffers.Builder, numElems:number) {
  builder.startVector(1, numElems, 1);
}

static addSize(builder:flatbuffers.Builder, size:number) {
  builder.addFieldInt32(2, size, 0);
}

static endFileEntry(builder:flatbuffers.Builder):flatbuffers.Offset {
  const offset = builder.endObject();
  builder.requiredField(offset, 4)
  return offset;
}

static createFileEntry(builder:flatbuffers.Builder, pathOffset:flatbuffers.Offset, hashOffset:flatbuffers.Offset, size:number):flatbuffers.Offset {
  FileEntry.startFileEntry(builder);
  FileEntry.addPath(builder, pathOffset);
  FileEntry.addHash(builder, hashOffset);
  FileEntry.addSize(builder, size);
  return FileEntry.endFileEntry(builder);
}
}
