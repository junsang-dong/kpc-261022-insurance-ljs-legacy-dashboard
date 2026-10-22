import { SCHEMA_VERSION, type Workspace } from '../shared/types/index.ts';

/** 정식 버전에서 RemoteDataStore(서버 API + DB)로 교체해도 화면 코드는 바뀌지 않는다 (명세 6.4절). */
export interface DataStore {
  getWorkspace(): Promise<Workspace | null>;
  saveWorkspace(ws: Workspace): Promise<void>;
  exportJson(): Promise<Blob>;
  importJson(file: File): Promise<Workspace>;
  /** 영속 저장이 가능한지 (false면 메모리 저장 — 내보내기로 백업하라고 안내) */
  readonly persistent: boolean;
}

const KEY = 'migration-dashboard.workspace';

export function migrate(raw: unknown): Workspace {
  const w = raw as Partial<Workspace> | null;
  if (!w || typeof w !== 'object' || typeof w.schemaVersion !== 'number') throw new Error('작업 상태 파일 형식이 아닙니다.');
  if (w.schemaVersion > SCHEMA_VERSION) throw new Error(`이 앱보다 새로운 버전(${w.schemaVersion})의 파일입니다.`);
  if (!Array.isArray(w.applications) || !Array.isArray(w.refs) || !w.scoring) throw new Error('필수 항목(applications, refs, scoring)이 없습니다.');
  // 이전 버전 파일 보정은 여기서 schemaVersion별로 수행한다
  return { ...(w as Workspace), schemaVersion: SCHEMA_VERSION };
}

export class LocalDataStore implements DataStore {
  persistent = true;
  private memory: string | null = null;

  async getWorkspace(): Promise<Workspace | null> {
    let text: string | null = null;
    try {
      text = localStorage.getItem(KEY);
    } catch {
      this.persistent = false;
      text = this.memory;
    }
    if (!text) return null;
    try {
      return migrate(JSON.parse(text));
    } catch {
      return null;
    }
  }

  async saveWorkspace(ws: Workspace): Promise<void> {
    const text = JSON.stringify(ws);
    this.memory = text;
    try {
      localStorage.setItem(KEY, text);
      this.persistent = true;
    } catch {
      this.persistent = false; // 사생활 보호 모드·용량 초과: 메모리에만 보관
    }
  }

  async exportJson(): Promise<Blob> {
    return new Blob([this.memory ?? localStorage.getItem(KEY) ?? '{}'], { type: 'application/json' });
  }

  async importJson(file: File): Promise<Workspace> {
    return migrate(JSON.parse(await file.text()));
  }

  async clear(): Promise<void> {
    this.memory = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* 무시 */
    }
  }
}

export const dataStore = new LocalDataStore();
