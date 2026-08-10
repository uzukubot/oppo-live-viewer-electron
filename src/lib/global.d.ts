export {};

declare global {
  interface Window {
    /** preload.cjs 通过 contextBridge 暴露的主进程接口。 */
    api: {
      startScan(folder: string): Promise<{ folder: string; total: number }>;
      openPath(path: string): Promise<{ folder: string; index: number; total: number }>;
      loadPhoto(id: number): Promise<import("./types").PhotoMeta>;
      pickFolder(): Promise<string | null>;
      onScanBatch(
        cb: (payload: { folder: string; photos: import("./types").PhotoMeta[] }) => void,
      ): () => void;
      onScanDone(cb: (payload: { folder: string }) => void): () => void;
      onScanMeta(cb: (payload: { folder: string; photos: import("./types").PhotoMeta[] }) => void): () => void;
      prioritizeScan(id: number): void;
      getPathForFile(file: File): string;
      onOpenPath(cb: (path: string) => void): () => void;
      getPendingOpenPath(): Promise<string | null>;
    };
    env: {
      electron: string;
      chrome: string;
      node: string;
    };
  }
}
