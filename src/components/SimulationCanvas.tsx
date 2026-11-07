import { useEffect, useRef } from 'react';
import type { NavGraph } from '../geometry/NavigationGraph';
import type { Floor, GeometryData, MapOverlay } from '../geometry/types';
import type { Dyn, Frame, View } from './MapRenderer';
import { drawScene, fitView, screenToWorld, worldToScreen } from './MapRenderer';

export type FloorMode = 'floor1' | 'balcony' | 'split';

export interface CanvasOptions {
  showLinks: boolean;
  showLabels: boolean;
  showSeats: boolean;
  showAgents: boolean;
  highlightApprox?: boolean;
  overlayOpacity: number;
  overlayKind: 'plan' | 'chart';
}

interface Props {
  geo: GeometryData;
  graph: NavGraph;
  floorMode: FloorMode;
  options: CanvasOptions;
  dark: boolean;
  getFrame: () => Frame | null;
  getDyn: () => Dyn;
  onClickWorld?: (x: number, y: number, floor: Floor, ev: MouseEvent) => void;
  /** editor drag: return true to capture the drag (no panning) */
  onDragStart?: (x: number, y: number, floor: Floor) => boolean;
  onDragMove?: (x: number, y: number, floor: Floor) => void;
  onDragEnd?: () => void;
  selectedNode?: string | null;
  selectedLink?: string | null;
  overlayOverride?: Record<string, MapOverlay>;
  /** extra layer drawn on top of each pane (world -> screen mapping, floor, px per metre) */
  drawOverlay?: (ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number) => [number, number], floor: Floor, scale: number) => void;
}

const imageCache = new Map<string, HTMLImageElement>();
function loadImage(src: string): HTMLImageElement {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return img;
}

export function SimulationCanvas(p: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const props = useRef(p);
  props.current = p;
  const views = useRef<Record<number, View | null>>({ 1: null, 2: null });

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let size = { w: 0, h: 0 };
    const panes = () => {
      const mode = props.current.floorMode;
      if (mode === 'split') {
        const half = size.w / 2;
        return [
          { floor: 1 as Floor, x: 0, w: half },
          { floor: 2 as Floor, x: half, w: size.w - half },
        ];
      }
      return [{ floor: (mode === 'balcony' ? 2 : 1) as Floor, x: 0, w: size.w }];
    };
    const ensureViews = () => {
      for (const pn of panes()) if (!views.current[pn.floor]) views.current[pn.floor] = fitView(pn.floor, pn.w, size.h);
    };
    const resize = () => {
      const r = canvas.parentElement!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size = { w: Math.max(200, r.width), h: Math.max(200, r.height) };
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      canvas.style.width = `${size.w}px`;
      canvas.style.height = `${size.h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      views.current = { 1: null, 2: null };
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    resize();

    const draw = () => {
      const P = props.current;
      ensureViews();
      const dpr = window.devicePixelRatio || 1;
      const frame = P.getFrame();
      const dyn = P.getDyn();
      for (const pn of panes()) {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, pn.x * dpr, 0);
        ctx.beginPath();
        ctx.rect(0, 0, pn.w, size.h);
        ctx.clip();
        const want = P.options.overlayKind === 'chart' ? (pn.floor === 1 ? 'chart1' : 'chart2') : pn.floor === 1 ? 'plan1' : 'plan2';
        const def = P.overlayOverride?.[want] ?? P.geo.overlays.find((o) => o.id === want);
        const img = def ? loadImage(def.image) : null;
        drawScene(
          ctx,
          pn.w,
          size.h,
          views.current[pn.floor]!,
          P.geo,
          P.graph,
          {
            floor: pn.floor,
            overlay: def && img && img.complete && img.naturalWidth > 0 ? { img, def, opacity: P.options.overlayOpacity } : null,
            showLinks: P.options.showLinks,
            showLabels: P.options.showLabels,
            showSeats: P.options.showSeats,
            showAgents: P.options.showAgents,
            highlightApprox: P.options.highlightApprox,
            dark: P.dark,
            selectedNode: P.selectedNode,
            selectedLink: P.selectedLink,
            title: P.floorMode === 'split' ? (pn.floor === 1 ? 'FIRST FLOOR (orchestra, loge/mezzanine, corridor, foyer)' : 'BALCONY (second floor)') : undefined,
          },
          frame,
          dyn,
        );
        if (P.drawOverlay) {
          const v = views.current[pn.floor]!;
          P.drawOverlay(ctx, (x, y) => worldToScreen(v, pn.w, size.h, x, y), pn.floor, v.scale);
        }
        ctx.restore();
        if (P.floorMode === 'split' && pn.x > 0) {
          ctx.save();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.strokeStyle = P.dark ? '#3a3936' : '#d9d7d0';
          ctx.beginPath();
          ctx.moveTo(pn.x, 0);
          ctx.lineTo(pn.x, size.h);
          ctx.stroke();
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // ---- interaction ----
    const paneAt = (sx: number) => panes().find((pn) => sx >= pn.x && sx < pn.x + pn.w) ?? panes()[0];
    const toWorld = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const sx = ev.clientX - r.left;
      const sy = ev.clientY - r.top;
      const pn = paneAt(sx);
      const v = views.current[pn.floor]!;
      const [x, y] = screenToWorld(v, pn.w, size.h, sx - pn.x, sy);
      return { x, y, floor: pn.floor, pn, sx, sy };
    };
    let drag: { mode: 'pan' | 'edit'; lastX: number; lastY: number; floor: Floor; moved: boolean } | null = null;
    const onDown = (ev: MouseEvent) => {
      const w = toWorld(ev);
      const captured = props.current.onDragStart?.(w.x, w.y, w.floor) ?? false;
      drag = { mode: captured ? 'edit' : 'pan', lastX: ev.clientX, lastY: ev.clientY, floor: w.floor, moved: false };
    };
    const onMove = (ev: MouseEvent) => {
      if (!drag) return;
      const dx = ev.clientX - drag.lastX;
      const dy = ev.clientY - drag.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      if (drag.mode === 'pan') {
        const v = views.current[drag.floor]!;
        v.cx -= dx / v.scale;
        v.cy -= dy / v.scale;
        if (props.current.floorMode === 'split') {
          const o = views.current[drag.floor === 1 ? 2 : 1];
          if (o) {
            o.cx -= dx / o.scale;
            o.cy -= dy / o.scale;
          }
        }
      } else {
        const w = toWorld(ev);
        props.current.onDragMove?.(w.x, w.y, drag.floor);
      }
      drag.lastX = ev.clientX;
      drag.lastY = ev.clientY;
    };
    const onUp = (ev: MouseEvent) => {
      if (drag && !drag.moved) {
        const w = toWorld(ev);
        props.current.onClickWorld?.(w.x, w.y, w.floor, ev);
      }
      if (drag?.mode === 'edit') props.current.onDragEnd?.();
      drag = null;
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const w = toWorld(ev);
      const factor = Math.exp(-ev.deltaY * 0.0015);
      const apply = (v: View) => {
        const ns = Math.min(80, Math.max(3, v.scale * factor));
        v.cx = w.x - ((w.x - v.cx) * v.scale) / ns;
        v.cy = w.y - ((w.y - v.cy) * v.scale) / ns;
        v.scale = ns;
      };
      apply(views.current[w.floor]!);
      if (props.current.floorMode === 'split') {
        const o = views.current[w.floor === 1 ? 2 : 1];
        if (o) {
          const ns = Math.min(80, Math.max(3, o.scale * factor));
          o.scale = ns;
        }
      }
    };
    const onDbl = () => {
      views.current = { 1: null, 2: null };
    };
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDbl);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
    };
  }, []);

  // reset the view when the floor mode changes
  useEffect(() => {
    views.current = { 1: null, 2: null };
  }, [p.floorMode]);

  return <canvas ref={ref} className="sim-canvas" />;
}
