

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import * as flatbuffers from 'flatbuffers';

export class NodeDependency {
  bb: flatbuffers.ByteBuffer|null = null;
  bb_pos = 0;
  __init(i:number, bb:flatbuffers.ByteBuffer):NodeDependency {
  this.bb_pos = i;
  this.bb = bb;
  return this;
}

static getRootAsNodeDependency(bb:flatbuffers.ByteBuffer, obj?:NodeDependency):NodeDependency {
  return (obj || new NodeDependency()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
}

static getSizePrefixedRootAsNodeDependency(bb:flatbuffers.ByteBuffer, obj?:NodeDependency):NodeDependency {
  bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
  return (obj || new NodeDependency()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
}

name():string|null
name(optionalEncoding:flatbuffers.Encoding):string|Uint8Array|null
name(optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 4);
  return offset ? this.bb!.__string(this.bb_pos + offset, optionalEncoding) : null;
}

version():string|null
version(optionalEncoding:flatbuffers.Encoding):string|Uint8Array|null
version(optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 6);
  return offset ? this.bb!.__string(this.bb_pos + offset, optionalEncoding) : null;
}

static startNodeDependency(builder:flatbuffers.Builder) {
  builder.startObject(2);
}

static addName(builder:flatbuffers.Builder, nameOffset:flatbuffers.Offset) {
  builder.addFieldOffset(0, nameOffset, 0);
}

static addVersion(builder:flatbuffers.Builder, versionOffset:flatbuffers.Offset) {
  builder.addFieldOffset(1, versionOffset, 0);
}

static endNodeDependency(builder:flatbuffers.Builder):flatbuffers.Offset {
  const offset = builder.endObject();
  builder.requiredField(offset, 4)
  return offset;
}

static createNodeDependency(builder:flatbuffers.Builder, nameOffset:flatbuffers.Offset, versionOffset:flatbuffers.Offset):flatbuffers.Offset {
  NodeDependency.startNodeDependency(builder);
  NodeDependency.addName(builder, nameOffset);
  NodeDependency.addVersion(builder, versionOffset);
  return NodeDependency.endNodeDependency(builder);
}
}
