

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import * as flatbuffers from 'flatbuffers';

import { IntegrityPayload } from '../../zene/system/integrity-payload.js';
import { NodeDependency } from '../../zene/system/node-dependency.js';


export class ZeneManifest {
  bb: flatbuffers.ByteBuffer|null = null;
  bb_pos = 0;
  __init(i:number, bb:flatbuffers.ByteBuffer):ZeneManifest {
  this.bb_pos = i;
  this.bb = bb;
  return this;
}

static getRootAsZeneManifest(bb:flatbuffers.ByteBuffer, obj?:ZeneManifest):ZeneManifest {
  return (obj || new ZeneManifest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
}

static getSizePrefixedRootAsZeneManifest(bb:flatbuffers.ByteBuffer, obj?:ZeneManifest):ZeneManifest {
  bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
  return (obj || new ZeneManifest()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
}

id():string|null
id(optionalEncoding:flatbuffers.Encoding):string|Uint8Array|null
id(optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 4);
  return offset ? this.bb!.__string(this.bb_pos + offset, optionalEncoding) : null;
}

name():string|null
name(optionalEncoding:flatbuffers.Encoding):string|Uint8Array|null
name(optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 6);
  return offset ? this.bb!.__string(this.bb_pos + offset, optionalEncoding) : null;
}

version():string|null
version(optionalEncoding:flatbuffers.Encoding):string|Uint8Array|null
version(optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 8);
  return offset ? this.bb!.__string(this.bb_pos + offset, optionalEncoding) : null;
}

description():string|null
description(optionalEncoding:flatbuffers.Encoding):string|Uint8Array|null
description(optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 10);
  return offset ? this.bb!.__string(this.bb_pos + offset, optionalEncoding) : null;
}

author():string|null
author(optionalEncoding:flatbuffers.Encoding):string|Uint8Array|null
author(optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 12);
  return offset ? this.bb!.__string(this.bb_pos + offset, optionalEncoding) : null;
}

dependencies(index: number):string
dependencies(index: number,optionalEncoding:flatbuffers.Encoding):string|Uint8Array
dependencies(index: number,optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 14);
  return offset ? this.bb!.__string(this.bb!.__vector(this.bb_pos + offset) + index * 4, optionalEncoding) : null;
}

dependenciesLength():number {
  const offset = this.bb!.__offset(this.bb_pos, 14);
  return offset ? this.bb!.__vector_len(this.bb_pos + offset) : 0;
}

zeneVersion():string|null
zeneVersion(optionalEncoding:flatbuffers.Encoding):string|Uint8Array|null
zeneVersion(optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 16);
  return offset ? this.bb!.__string(this.bb_pos + offset, optionalEncoding) : null;
}

nodeVersion():string|null
nodeVersion(optionalEncoding:flatbuffers.Encoding):string|Uint8Array|null
nodeVersion(optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 18);
  return offset ? this.bb!.__string(this.bb_pos + offset, optionalEncoding) : null;
}

integrity(obj?:IntegrityPayload):IntegrityPayload|null {
  const offset = this.bb!.__offset(this.bb_pos, 20);
  return offset ? (obj || new IntegrityPayload()).__init(this.bb!.__indirect(this.bb_pos + offset), this.bb!) : null;
}

nodeDependencies(index: number, obj?:NodeDependency):NodeDependency|null {
  const offset = this.bb!.__offset(this.bb_pos, 22);
  return offset ? (obj || new NodeDependency()).__init(this.bb!.__indirect(this.bb!.__vector(this.bb_pos + offset) + index * 4), this.bb!) : null;
}

nodeDependenciesLength():number {
  const offset = this.bb!.__offset(this.bb_pos, 22);
  return offset ? this.bb!.__vector_len(this.bb_pos + offset) : 0;
}

static startZeneManifest(builder:flatbuffers.Builder) {
  builder.startObject(10);
}

static addId(builder:flatbuffers.Builder, idOffset:flatbuffers.Offset) {
  builder.addFieldOffset(0, idOffset, 0);
}

static addName(builder:flatbuffers.Builder, nameOffset:flatbuffers.Offset) {
  builder.addFieldOffset(1, nameOffset, 0);
}

static addVersion(builder:flatbuffers.Builder, versionOffset:flatbuffers.Offset) {
  builder.addFieldOffset(2, versionOffset, 0);
}

static addDescription(builder:flatbuffers.Builder, descriptionOffset:flatbuffers.Offset) {
  builder.addFieldOffset(3, descriptionOffset, 0);
}

static addAuthor(builder:flatbuffers.Builder, authorOffset:flatbuffers.Offset) {
  builder.addFieldOffset(4, authorOffset, 0);
}

static addDependencies(builder:flatbuffers.Builder, dependenciesOffset:flatbuffers.Offset) {
  builder.addFieldOffset(5, dependenciesOffset, 0);
}

static createDependenciesVector(builder:flatbuffers.Builder, data:flatbuffers.Offset[]):flatbuffers.Offset {
  builder.startVector(4, data.length, 4);
  for (let i = data.length - 1; i >= 0; i--) {
    builder.addOffset(data[i]!);
  }
  return builder.endVector();
}

static startDependenciesVector(builder:flatbuffers.Builder, numElems:number) {
  builder.startVector(4, numElems, 4);
}

static addZeneVersion(builder:flatbuffers.Builder, zeneVersionOffset:flatbuffers.Offset) {
  builder.addFieldOffset(6, zeneVersionOffset, 0);
}

static addNodeVersion(builder:flatbuffers.Builder, nodeVersionOffset:flatbuffers.Offset) {
  builder.addFieldOffset(7, nodeVersionOffset, 0);
}

static addIntegrity(builder:flatbuffers.Builder, integrityOffset:flatbuffers.Offset) {
  builder.addFieldOffset(8, integrityOffset, 0);
}

static addNodeDependencies(builder:flatbuffers.Builder, nodeDependenciesOffset:flatbuffers.Offset) {
  builder.addFieldOffset(9, nodeDependenciesOffset, 0);
}

static createNodeDependenciesVector(builder:flatbuffers.Builder, data:flatbuffers.Offset[]):flatbuffers.Offset {
  builder.startVector(4, data.length, 4);
  for (let i = data.length - 1; i >= 0; i--) {
    builder.addOffset(data[i]!);
  }
  return builder.endVector();
}

static startNodeDependenciesVector(builder:flatbuffers.Builder, numElems:number) {
  builder.startVector(4, numElems, 4);
}

static endZeneManifest(builder:flatbuffers.Builder):flatbuffers.Offset {
  const offset = builder.endObject();
  return offset;
}

static finishZeneManifestBuffer(builder:flatbuffers.Builder, offset:flatbuffers.Offset) {
  builder.finish(offset);
}

static finishSizePrefixedZeneManifestBuffer(builder:flatbuffers.Builder, offset:flatbuffers.Offset) {
  builder.finish(offset, undefined, true);
}

}
