import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useStatic } from '../store/staticData.ts';
import { useWs } from '../store/workspace.ts';
import { AssistantPanel } from '../features/assistant/AssistantPanel.tsx';
import { useAssistant } from '../features/assistant/aiClient.ts';
import { Summary } from '../features/summary/Summary.tsx';
import { Inventory } from '../features/inventory/Inventory.tsx';
import { AppDetail } from '../features/apps/AppDetail.tsx';
import { Findings } from '../features/findings/Findings.tsx';
import { Board } from '../features/steps/Board.tsx';
import { Waves } from '../features/waves/Waves.tsx';
import { Risks } from '../features/risks/Risks.tsx';
import { Cost } from '../features/cost/Cost.tsx';
import { Regulation } from '../features/regulation/Regulation.tsx';
import { RefCompare } from '../features/refs/RefCompare.tsx';
import { Validation } from '../features/refs/Validation.tsx';
import { Report } from '../features/report/Report.tsx';
import { Settings } from '../features/settings/Settings.tsx';
import { Analyze } from '../features/analyze/Analyze.tsx';
import type { Workspace } from '../shared/types/index.ts';

const NAV: { to: string; label: string; group: string; views: Workspace['viewpoint'][] }[] = [
  { to: '/', label: '요약 대시보드', group: '현황', views: ['architect', 'pm', 'exec'] },
  { to: '/inventory', label: '인벤토리', group: '현황', views: ['architect', 'pm'] },
  { to: '/analyze', label: '저장소 분석', group: '분석', views: ['architect', 'pm'] },
  { to: '/refs', label: 'Git Ref 비교', group: '분석', views: ['architect'] },
  { to: '/findings', label: '탐지 결과', group: '분석', views: ['architect'] },
  { to: '/validation', label: '규칙 검증', group: '분석', views: ['architect'] },
  { to: '/board', label: '전환 경로 보드', group: '계획', views: ['architect', 'pm'] },
  { to: '/waves', label: '웨이브 계획', group: '계획', views: ['architect', 'pm', 'exec'] },
  { to: '/risks', label: '리스크', group: '계획', views: ['architect', 'pm', 'exec'] },
  { to: '/cost', label: '비용 추정', group: '계획', views: ['pm', 'architect', 'exec'] },
  { to: '/compliance', label: '규제·체크리스트', group: '계획', views: ['pm', 'architect'] },
  { to: '/report', label: '보고서', group: '내보내기', views: ['architect', 'pm', 'exec'] },
  { to: '/settings', label: '설정', group: '내보내기', views: ['architect', 'pm'] },
];

export function App() {
  const { data: sd, error, isLoading } = useStatic();
  const { ws, ready, init, persistent, setViewpoint, setActor } = useWs();
  const setOpen = useAssistant((s) => s.setOpen);
  const open = useAssistant((s) => s.open);

  useEffect(() => {
    if (sd && !ready) void init(sd);
  }, [sd, ready, init]);

  if (isLoading) return <p style={{ padding: 24 }}>데이터를 불러오는 중…</p>;
  if (error || !sd) {
    return (
      <div className="page">
        <h1>데이터를 불러오지 못했습니다</h1>
        <p className="muted">`npm run build:rules` 로 public/data/rules.json 을 생성했는지 확인하세요. ({String((error as Error)?.message)})</p>
      </div>
    );
  }
  if (!ws) return <p style={{ padding: 24 }}>작업 공간을 준비하는 중…</p>;

  const items = NAV.filter((n) => n.views.includes(ws.viewpoint));
  const groups = [...new Set(items.map((n) => n.group))];

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          마이그레이션 대시보드
          <small>PoC MVP · 명세 v1.2</small>
        </div>
        <nav aria-label="주 메뉴">
          {groups.map((g) => (
            <div key={g}>
              <div className="group">{g}</div>
              {items.filter((n) => n.group === g).map((n) => (
                <NavLink key={n.to} to={n.to} end={n.to === '/'}>{n.label}</NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="main">
        <div className="top">
          <label className="row small">
            <span className="muted">보기 관점</span>
            <select value={ws.viewpoint} onChange={(e) => setViewpoint(e.target.value as Workspace['viewpoint'])} aria-label="보기 관점">
              <option value="architect">아키텍트·개발자</option>
              <option value="pm">PM</option>
              <option value="exec">경영진</option>
            </select>
          </label>
          <label className="row small">
            <span className="muted">확인자</span>
            <input type="text" value={ws.actor} onChange={(e) => setActor(e.target.value)} aria-label="확인자 이름" style={{ width: 120 }} />
          </label>
          <span className="spacer" />
          <button className="btn" onClick={() => setOpen(!open)}>✦ AI 어시스턴트</button>
        </div>
        <div className="notice">
          공개 저장소와 가상 데이터 전용 PoC입니다. 사내 비공개 소스·실제 계약 데이터는 입력하지 마세요.
          {!persistent && ' · ⚠ 브라우저 저장소를 쓸 수 없어 메모리에만 보관 중입니다. 설정에서 JSON으로 내보내 백업하세요.'}
        </div>
        <main className="page">
          <Routes>
            <Route path="/" element={<Summary />} />
            <Route path="/analyze" element={<Analyze />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/apps/:id" element={<AppDetail />} />
            <Route path="/findings" element={<Findings />} />
            <Route path="/board" element={<Board />} />
            <Route path="/waves" element={<Waves />} />
            <Route path="/risks" element={<Risks />} />
            <Route path="/cost" element={<Cost />} />
            <Route path="/compliance" element={<Regulation />} />
            <Route path="/refs" element={<RefCompare />} />
            <Route path="/validation" element={<Validation />} />
            <Route path="/report" element={<Report />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <AssistantPanel />
    </div>
  );
}
