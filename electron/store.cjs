'use strict';

// store.rs 的 Node 移植：id→路径注册表 + 字节 LRU 缓存 + 流式扫描状态。

class FileStore {
  constructor(cap) {
    this.map = new Map(); // id → { jpeg: Buffer, mp4: Buffer|null }
    this.paths = new Map(); // id → 磁盘路径
    this.order = []; // id 列表，index 0 = 最近使用
    this.cap = cap;
    this.nextId = 1;
    this.scan = null; // { paths, index, generation }
    this.generation = 0;
  }

  registerPath(p) {
    const id = this.nextId;
    this.nextId += 1;
    this.paths.set(id, p);
    return id;
  }

  path(id) {
    return this.paths.get(id);
  }

  insert(id, file) {
    this.map.set(id, file);
    this.order = this.order.filter((x) => x !== id);
    this.order.unshift(id);
    while (this.order.length > this.cap) {
      const evict = this.order.pop();
      if (evict !== undefined && evict !== id) this.map.delete(evict);
    }
  }

  get(id) {
    if (this.map.has(id)) {
      this.order = this.order.filter((x) => x !== id);
      this.order.unshift(id);
    }
    return this.map.get(id);
  }
}

module.exports = { FileStore };
