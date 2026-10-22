import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, RadarChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, RadarComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, PieChart, RadarChart, GridComponent, LegendComponent, TooltipComponent, RadarComponent, CanvasRenderer]);

type Option = Parameters<ReturnType<typeof echarts.init>['setOption']>[0];

/** 테마 색을 CSS 변수에서 읽어 라이트/다크 모두 대비를 유지한다. */
export const themeColors = () => {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return { text: v('--text'), muted: v('--muted'), line: v('--line'), accent: v('--accent'), ok: v('--ok'), warn: v('--warn'), bad: v('--bad'), synthetic: v('--synthetic') };
};

export function Chart({ option, tall, label }: { option: Option; tall?: boolean; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const [scheme, setScheme] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setScheme((n) => n + 1);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    if (!el.current) return;
    inst.current ??= echarts.init(el.current);
    const c = themeColors();
    inst.current.setOption({ backgroundColor: 'transparent', textStyle: { color: c.text, fontFamily: 'inherit' }, ...option }, true);
  }, [option, scheme]);

  useEffect(() => {
    const ro = new ResizeObserver(() => inst.current?.resize());
    if (el.current) ro.observe(el.current);
    return () => {
      ro.disconnect();
      inst.current?.dispose();
      inst.current = null;
    };
  }, []);

  return <div ref={el} className={`chart ${tall ? 'tall' : ''}`} role="img" aria-label={label} />;
}
