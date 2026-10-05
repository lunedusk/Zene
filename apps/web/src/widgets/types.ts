




export type WidgetSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface WidgetDefinition {
  id: string;
  type: string;
  title: string;
  description?: string;
  icon?: string;
  size?: WidgetSize;
  minSize?: WidgetSize;
  maxSize?: WidgetSize;
  dataSource?: string;
  refreshPolicy?: 'manual' | 'interval' | 'realtime';
  refreshIntervalMs?: number;

  visibility?: unknown;
  pluginId?: string;
  version?: string;
  props?: Record<string, unknown>;
}

export interface WidgetInstance {
  instanceId: string;
  widgetId: string;
  definition: WidgetDefinition;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  props?: Record<string, unknown>;
}

export type Breakpoint = 'desktop' | 'tablet' | 'mobile';

export interface LayoutBreakpointState {
  breakpoint: Breakpoint;
  columns: number;
  widgets: WidgetInstance[];
}

export interface DashboardLayout {
  layoutId: string;
  surfaceId: string;
  version?: number;
  breakpoints: Record<Breakpoint, LayoutBreakpointState>;
}
