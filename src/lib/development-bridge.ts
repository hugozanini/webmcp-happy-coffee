export type DevelopmentCellKind = 'query' | 'quality';
export type DevelopmentQualitySeverity = 'Info' | 'Warning' | 'Error' | 'Critical';

export type DevelopmentBridgeAction =
  | { type: 'inspect' }
  | { type: 'create-notebook'; name?: string }
  | { type: 'select-notebook'; notebookId: string }
  | { type: 'close-notebook'; notebookId: string }
  | {
    type: 'create-cell';
    notebookId?: string;
    sql: string;
    kind?: DevelopmentCellKind;
    name?: string;
    description?: string;
    severity?: DevelopmentQualitySeverity;
    activate?: boolean;
  }
  | {
    type: 'update-cell';
    cellId: string;
    sql?: string;
    kind?: DevelopmentCellKind;
    name?: string;
    description?: string;
    severity?: DevelopmentQualitySeverity;
  }
  | { type: 'delete-cell'; cellId: string }
  | { type: 'run-cell'; cellId: string }
  | { type: 'reset-workspace' }
  | {
    type: 'prepare-publication';
    sourceCellId?: string;
    name?: string;
    displayName?: string;
    description?: string;
    owner?: string;
    tags?: string;
    criticality?: 'Critical' | 'High' | 'Medium' | 'Low';
    frequency?: string;
    cron?: string;
    transformations?: string;
    qualityCellIds?: string[];
    fieldDescriptions?: Record<string, string>;
  }
  | {
    type: 'set-view';
    bottomTab?: 'results' | 'publishing';
    explorerCollapsed?: boolean;
    bottomPanelOpen?: boolean;
    bottomPanelHeight?: number;
  };

export type DevelopmentBridgeResult = { ok: boolean; message: string; data?: unknown };
type Request = { action: DevelopmentBridgeAction; resolve: (result: DevelopmentBridgeResult) => void };
type Handler = (action: DevelopmentBridgeAction) => Promise<DevelopmentBridgeResult> | DevelopmentBridgeResult;

let handler: Handler | null = null;
const queue: Request[] = [];

async function flush() {
  if (!handler) return;
  while (queue.length && handler) {
    const request = queue.shift()!;
    try {
      request.resolve(await handler(request.action));
    } catch (error) {
      request.resolve({ ok: false, message: error instanceof Error ? error.message : 'The development workspace could not complete the request.' });
    }
  }
}

export function requestDevelopmentAction(action: DevelopmentBridgeAction): Promise<DevelopmentBridgeResult> {
  return new Promise((resolve) => {
    queue.push({ action, resolve });
    void flush();
  });
}

export function registerDevelopmentActionHandler(nextHandler: Handler) {
  handler = nextHandler;
  void flush();
  return () => {
    if (handler === nextHandler) handler = null;
  };
}

export function hasDevelopmentActionHandler() {
  return handler !== null;
}
