import { useEffect, useState } from 'react';
import { Chart, themeColors } from '../../app/Chart.tsx';
import { Alert, Card, SyntheticBadge, fmtKRW } from '../../app/ui.tsx';
import { computeCost } from '../../shared/scoring/index.ts';
import type { CostInput } from '../../shared/types/index.ts';
import { useAppImpacts } from '../../store/derived.ts';
import { useWs } from '../../store/workspace.ts';
import { useAssistant } from '../assistant/aiClient.ts';

export function Cost() {
  const d = useAppImpacts();
  const setCost = useWs((s) => s.setCost);
  const [appId, setAppId] = useState('');
  const setContext = useAssistant((s) => s.setContext);
  useEffect(() => setContext({ screen: '비용 추정' }), [setContext]);
  if (!d) return null;
  const { ws, sd } = d;
  const p = sd.pricing;
  const rows = ws.costInputs.map((c) => ({ c, r: computeCost(c, p), app: ws.applications.find((a) => a.id === c.appId) }));
  const sel = appId || ws.applications[0]?.id || '';
  const cur: CostInput = ws.costInputs.find((c) => c.appId === sel) ?? { appId: sel, asisAnnual: 0, containers: 2, vcpuPerContainer: 2, memGbPerContainer: 4, dbTier: Object.keys(p.dbTiers)[0], dbGb: 10, storageGb: 50, egressGbMonth: 50, parallelMonths: 1 };
  const srv = sd.inventory.servers.find((s) => s.appId === sel);
  const sizing = srv ? Math.ceil((srv.cores * srv.peakCpu) / 100 / 0.7) : null;
  const c = themeColors();
  const total = rows.reduce((a, x) => ({ asis: a.asis + x.r.asisAnnual, tgt: a.tgt + x.r.targetAnnual, par: a.par + x.r.parallel }), { asis: 0, tgt: 0, par: 0 });

  const option = {
    grid: { left: 70, right: 12, top: 30, bottom: 40 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmtKRW(v) },
    legend: { top: 0, textStyle: { color: c.text } },
    xAxis: { type: 'category', data: rows.map((x) => x.app?.id ?? x.c.appId), axisLabel: { color: c.muted, fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { color: c.muted, formatter: (v: number) => fmtKRW(v) }, splitLine: { lineStyle: { color: c.line } } },
    series: [
      { name: '현행 연간', type: 'bar', data: rows.map((x) => x.r.asisAnnual), itemStyle: { color: c.muted } },
      { name: '목표 연간', type: 'bar', data: rows.map((x) => x.r.targetAnnual), itemStyle: { color: c.accent } },
      { name: '병행 운영(일시)', type: 'bar', data: rows.map((x) => x.r.parallel), itemStyle: { color: c.warn } },
    ],
  };
  const num = (k: keyof CostInput, v: string) => setCost({ ...cur, [k]: Math.max(0, Number(v) || 0) });

  return (
    <>
      <div className="page-head">
        <div><h1>비용 추정</h1><p>컨테이너·관리형 DB·스토리지·송신 트래픽 기준의 간이 계산입니다.</p></div>
      </div>
      <Alert kind="info">{p.unitNote} — 단가는 <code>public/data/seed/pricing.json</code> 의 입력값이며 클라우드 사업자 가격을 자동 조회하지 않습니다.</Alert>
      <div className="grid cols-2">
        <Card title="현행 vs 목표 TCO"><Chart option={option} label="앱별 현행 연간 비용과 목표 연간 비용, 병행 운영 비용 막대 차트" /></Card>
        <Card title="합계" actions={<SyntheticBadge text="가상 입력" />}>
          <div className="grid cols-3">
            <div><div className="muted small">현행 연간</div><div className="stat"><div className="v">{fmtKRW(total.asis)}</div></div></div>
            <div><div className="muted small">목표 연간</div><div className="stat"><div className="v">{fmtKRW(total.tgt)}</div></div></div>
            <div><div className="muted small">병행 운영 일시</div><div className="stat"><div className="v">{fmtKRW(total.par)}</div></div></div>
          </div>
          <p className="small muted">목표 월 비용 = 컨테이너(vCPU·메모리) + DB 등급 + 스토리지 + 송신 트래픽. 병행 비용 = 목표 월 비용 × 병행 개월. 현행 비용은 수동 입력(하드웨어 유지보수·라이선스·상면).</p>
          {total.tgt > total.asis && total.asis > 0 && <Alert kind="warn">비용 입력이 있는 앱 합계에서 목표 연간 비용이 현행보다 큽니다. 사이징과 상용 라이선스 가정을 재검토하세요.</Alert>}
        </Card>
      </div>

      <Card title="앱별 입력">
        <div className="row" style={{ marginBottom: 8 }}>
          <label className="field">앱<select value={sel} onChange={(e) => setAppId(e.target.value)}>{ws.applications.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          {sizing && <span className="small muted" style={{ alignSelf: 'end' }}>참고: {srv!.hostname} 피크 CPU {srv!.peakCpu}% × {srv!.cores}코어 → 목표 사용률 70% 기준 약 {sizing} vCPU (<SyntheticBadge />)</span>}
        </div>
        <div className="grid cols-4">
          <label className="field">현행 연간 비용(원)<input type="number" value={cur.asisAnnual} onChange={(e) => num('asisAnnual', e.target.value)} /></label>
          <label className="field">컨테이너 수<input type="number" value={cur.containers} onChange={(e) => num('containers', e.target.value)} /></label>
          <label className="field">컨테이너당 vCPU<input type="number" value={cur.vcpuPerContainer} onChange={(e) => num('vcpuPerContainer', e.target.value)} /></label>
          <label className="field">컨테이너당 메모리(GB)<input type="number" value={cur.memGbPerContainer} onChange={(e) => num('memGbPerContainer', e.target.value)} /></label>
          <label className="field">관리형 DB 등급<select value={cur.dbTier} onChange={(e) => setCost({ ...cur, dbTier: e.target.value })}>{Object.keys(p.dbTiers).map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="field">DB 용량(GB)<input type="number" value={cur.dbGb} onChange={(e) => num('dbGb', e.target.value)} /></label>
          <label className="field">스토리지(GB)<input type="number" value={cur.storageGb} onChange={(e) => num('storageGb', e.target.value)} /></label>
          <label className="field">월 송신(GB)<input type="number" value={cur.egressGbMonth} onChange={(e) => num('egressGbMonth', e.target.value)} /></label>
          <label className="field">병행 운영(개월)<input type="number" value={cur.parallelMonths} onChange={(e) => num('parallelMonths', e.target.value)} /></label>
        </div>
      </Card>

      <Card title="산출 내역 (월)">
        <div className="table-wrap"><table>
          <thead><tr><th>앱</th><th className="num">컴퓨트</th><th className="num">DB</th><th className="num">스토리지</th><th className="num">송신</th><th className="num">목표 월</th><th className="num">목표 연</th><th className="num">현행 연</th><th className="num">병행</th></tr></thead>
          <tbody>{rows.map(({ c: x, r, app }) => (
            <tr key={x.appId}><td>{app?.name ?? x.appId}</td><td className="num">{fmtKRW(r.compute)}</td><td className="num">{fmtKRW(r.db)}</td><td className="num">{fmtKRW(r.storage)}</td><td className="num">{fmtKRW(r.egress)}</td><td className="num">{fmtKRW(r.targetMonthly)}</td><td className="num">{fmtKRW(r.targetAnnual)}</td><td className="num">{fmtKRW(r.asisAnnual)}</td><td className="num">{fmtKRW(r.parallel)}</td></tr>
          ))}</tbody>
        </table></div>
      </Card>
    </>
  );
}
